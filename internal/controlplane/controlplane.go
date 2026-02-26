package controlplane

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type SliceManifest struct {
	Description    string   `json:"description"`
	DefaultProfile string   `json:"defaultProfile"`
	Extensions     []string `json:"extensions"`
}

type Target struct {
	Name           string
	Slice          string
	DefaultProfile string
	Description    string
	Aliases        []string
}

type LaunchSpec struct {
	Args []string
	Env  []string
}

type SliceInfo struct {
	Name     string
	Manifest SliceManifest
}

var canonicalTargets = []Target{
	{
		Name:           "meta",
		Slice:          "meta",
		DefaultProfile: "meta",
		Description:    "Pi platform architecture + orchestration development",
		Aliases:        []string{"pi-dev", "pidev", "recon", "docs"},
	},
	{
		Name:           "build",
		Slice:          "software",
		DefaultProfile: "execute",
		Description:    "Daily software engineering workflow",
		Aliases:        []string{"software", "delivery", "dev", "eng", "work", "devflow", "ship", "release", "auto", "autopilot", "research"},
	},
	{
		Name:           "ops",
		Slice:          "sysadmin",
		DefaultProfile: "execute",
		Description:    "System reliability, incident forensics, and watchdog workflows",
		Aliases:        []string{"sysadmin", "admin", "argus", "guardian"},
	},
	{
		Name:           "daybook",
		Slice:          "daybook",
		DefaultProfile: "fast",
		Description:    "Charisma-first journaling and brainstorming workflow",
		Aliases:        []string{"journal", "diary"},
	},
}

var aliasToTarget = buildAliasMap(canonicalTargets)

func CanonicalTargets() []Target {
	out := make([]Target, len(canonicalTargets))
	copy(out, canonicalTargets)
	return out
}

func ResolveTarget(name string) (Target, bool) {
	normalized := strings.ToLower(strings.TrimSpace(name))
	if normalized == "" {
		return Target{}, false
	}

	index, ok := aliasToTarget[normalized]
	if !ok {
		return Target{}, false
	}
	return canonicalTargets[index], true
}

func DetermineRoot(rootOverride string) (string, error) {
	if rootOverride != "" {
		return mustBeRoot(rootOverride)
	}

	if envRoot := strings.TrimSpace(os.Getenv("PI_AGENT_CONFIG_ROOT")); envRoot != "" {
		root, err := mustBeRoot(envRoot)
		if err == nil {
			return root, nil
		}
	}

	if cwd, err := os.Getwd(); err == nil {
		if root, ok := findRootUp(cwd); ok {
			return root, nil
		}
	}

	home, _ := os.UserHomeDir()
	candidates := []string{
		filepath.Join(home, "Development", "pi-agent-config"),
	}

	for _, candidate := range candidates {
		root, err := mustBeRoot(candidate)
		if err == nil {
			return root, nil
		}
	}

	return "", errors.New("unable to locate pi-agent-config root; use --root or set PI_AGENT_CONFIG_ROOT")
}

func LoadSlices(root string) (map[string]SliceManifest, error) {
	sliceDir := filepath.Join(root, "slices")
	entries, err := os.ReadDir(sliceDir)
	if err != nil {
		return nil, fmt.Errorf("read slices dir: %w", err)
	}

	slices := make(map[string]SliceManifest)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		name := strings.TrimSuffix(entry.Name(), ".json")
		manifestPath := filepath.Join(sliceDir, entry.Name())
		manifest, err := loadSliceManifest(manifestPath)
		if err != nil {
			return nil, fmt.Errorf("load slice %s: %w", name, err)
		}
		slices[name] = manifest
	}

	if len(slices) == 0 {
		return nil, errors.New("no slice manifests found")
	}

	return slices, nil
}

func SortedSliceInfos(slices map[string]SliceManifest) []SliceInfo {
	infos := make([]SliceInfo, 0, len(slices))
	for name, manifest := range slices {
		infos = append(infos, SliceInfo{Name: name, Manifest: manifest})
	}
	sort.Slice(infos, func(i, j int) bool {
		return infos[i].Name < infos[j].Name
	})
	return infos
}

func BuildLaunchSpec(root string, manifest SliceManifest, strict bool, profileOverride string, forwardedArgs []string) (LaunchSpec, error) {
	if len(manifest.Extensions) == 0 {
		return LaunchSpec{}, errors.New("slice has no extensions configured")
	}

	args := []string{"--no-extensions"}
	if strict {
		args = append(args, "--no-skills", "--no-prompt-templates", "--no-themes")
	}

	for _, rel := range manifest.Extensions {
		rel = strings.TrimSpace(rel)
		if rel == "" {
			continue
		}

		extPath := filepath.Join(root, filepath.FromSlash(rel))
		stat, err := os.Stat(extPath)
		if err != nil {
			return LaunchSpec{}, fmt.Errorf("extension path missing: %s", rel)
		}
		if stat.IsDir() {
			return LaunchSpec{}, fmt.Errorf("extension path is directory, expected file: %s", rel)
		}
		args = append(args, "-e", extPath)
	}

	args = append(args, forwardedArgs...)
	env := os.Environ()

	profile := strings.TrimSpace(profileOverride)
	if profile == "" {
		profile = strings.TrimSpace(manifest.DefaultProfile)
	}

	if profile != "" && !HasProfileFlag(forwardedArgs) && strings.TrimSpace(os.Getenv("PI_DEFAULT_PROFILE")) == "" {
		env = append(env, "PI_DEFAULT_PROFILE="+profile)
	}

	return LaunchSpec{Args: args, Env: env}, nil
}

func LaunchPi(spec LaunchSpec) error {
	if _, err := exec.LookPath("pi"); err != nil {
		return errors.New("pi executable not found in PATH")
	}

	cmd := exec.Command("pi", spec.Args...)
	cmd.Env = spec.Env
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func HasProfileFlag(args []string) bool {
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--profile" {
			return true
		}
		if strings.HasPrefix(arg, "--profile=") {
			return true
		}
	}
	return false
}

func IsTTY() bool {
	info, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (info.Mode() & os.ModeCharDevice) != 0
}

func mustBeRoot(candidate string) (string, error) {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return "", errors.New("empty path")
	}

	abs, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}

	if !hasRootMarkers(abs) {
		return "", fmt.Errorf("not a valid pi-agent-config root: %s", abs)
	}
	return abs, nil
}

func findRootUp(start string) (string, bool) {
	current, err := filepath.Abs(start)
	if err != nil {
		return "", false
	}

	for {
		if hasRootMarkers(current) {
			return current, true
		}
		next := filepath.Dir(current)
		if next == current {
			return "", false
		}
		current = next
	}
}

func hasRootMarkers(dir string) bool {
	markers := []string{
		filepath.Join(dir, "settings.json"),
		filepath.Join(dir, "slices"),
		filepath.Join(dir, "extensions"),
	}

	for _, marker := range markers {
		if _, err := os.Stat(marker); err != nil {
			return false
		}
	}
	return true
}

func loadSliceManifest(path string) (SliceManifest, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return SliceManifest{}, err
	}

	var manifest SliceManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return SliceManifest{}, err
	}

	if len(manifest.Extensions) == 0 {
		return SliceManifest{}, errors.New("extensions must not be empty")
	}

	return manifest, nil
}

func buildAliasMap(targets []Target) map[string]int {
	out := make(map[string]int)
	for i, target := range targets {
		out[target.Name] = i
		for _, alias := range target.Aliases {
			out[alias] = i
		}
	}
	return out
}
