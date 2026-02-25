package main

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/phaedrus/pi-agent-config/internal/controlplane"
)

type globalOptions struct {
	Root    string
	Strict  bool
	Profile string
	Help    bool
}

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(argv []string) int {
	opts, tokens, forwardedAfterSeparator, err := parseArgs(argv)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		printUsage(os.Stderr)
		return 2
	}

	if opts.Help {
		printUsage(os.Stdout)
		return 0
	}

	if len(tokens) == 0 {
		target, pickErr := pickTargetInteractive()
		if pickErr != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", pickErr)
			return 2
		}
		return runTarget(opts, target, forwardedAfterSeparator)
	}

	first := strings.ToLower(tokens[0])
	switch first {
	case "help", "-h", "--help":
		printUsage(os.Stdout)
		return 0
	case "list", "targets":
		printTargets()
		return 0
	case "slices":
		return printSlices(opts)
	case "doctor":
		return runDoctor(opts)
	case "open":
		target := ""
		forwarded := forwardedAfterSeparator
		if len(tokens) > 1 {
			target = tokens[1]
			forwarded = append(tokens[2:], forwarded...)
		} else {
			picked, pickErr := pickTargetInteractive()
			if pickErr != nil {
				fmt.Fprintf(os.Stderr, "error: %v\n", pickErr)
				return 2
			}
			target = picked
		}
		return runTarget(opts, target, forwarded)
	case "slice":
		if len(tokens) < 2 {
			fmt.Fprintln(os.Stderr, "error: slice command requires a slice name")
			return 2
		}
		return runSlice(opts, tokens[1], append(tokens[2:], forwardedAfterSeparator...))
	default:
		if _, ok := controlplane.ResolveTarget(first); ok {
			return runTarget(opts, first, append(tokens[1:], forwardedAfterSeparator...))
		}
		fmt.Fprintf(os.Stderr, "error: unknown command or target %q\n", first)
		printUsage(os.Stderr)
		return 2
	}
}

func parseArgs(argv []string) (globalOptions, []string, []string, error) {
	opts := globalOptions{}
	pre, post := splitOnDoubleDash(argv)

	tokens := make([]string, 0, len(pre))
	for i := 0; i < len(pre); i++ {
		arg := pre[i]
		switch {
		case arg == "--strict":
			opts.Strict = true
		case arg == "-h" || arg == "--help":
			opts.Help = true
		case arg == "--root":
			if i+1 >= len(pre) {
				return opts, nil, nil, errors.New("--root requires a value")
			}
			i++
			opts.Root = pre[i]
		case strings.HasPrefix(arg, "--root="):
			opts.Root = strings.TrimPrefix(arg, "--root=")
		case arg == "--profile":
			if i+1 >= len(pre) {
				return opts, nil, nil, errors.New("--profile requires a value")
			}
			i++
			opts.Profile = pre[i]
		case strings.HasPrefix(arg, "--profile="):
			opts.Profile = strings.TrimPrefix(arg, "--profile=")
		default:
			tokens = append(tokens, arg)
		}
	}

	return opts, tokens, post, nil
}

func splitOnDoubleDash(args []string) ([]string, []string) {
	for i, arg := range args {
		if arg == "--" {
			return args[:i], args[i+1:]
		}
	}
	return args, nil
}

func printUsage(out *os.File) {
	fmt.Fprintln(out, "pictl - Pi control-plane launcher")
	fmt.Fprintln(out)
	fmt.Fprintln(out, "Usage:")
	fmt.Fprintln(out, "  pictl [global flags]                     # interactive target picker")
	fmt.Fprintln(out, "  pictl <target> [pi args...]              # launch target")
	fmt.Fprintln(out, "  pictl open <target> [pi args...]")
	fmt.Fprintln(out, "  pictl slice <slice> [pi args...]")
	fmt.Fprintln(out, "  pictl list|targets")
	fmt.Fprintln(out, "  pictl slices")
	fmt.Fprintln(out, "  pictl doctor")
	fmt.Fprintln(out)
	fmt.Fprintln(out, "Global flags:")
	fmt.Fprintln(out, "  --root <path>       Override pi-agent-config root")
	fmt.Fprintln(out, "  --strict            Disable discovered skills/prompts/themes")
	fmt.Fprintln(out, "  --profile <name>    Override profile (meta|execute|ship|fast aliases)")
	fmt.Fprintln(out, "  --help              Show help")
	fmt.Fprintln(out)
	fmt.Fprintln(out, "Examples:")
	fmt.Fprintln(out, "  pictl meta")
	fmt.Fprintln(out, "  pictl research --profile meta")
	fmt.Fprintln(out, "  pictl build --profile execute")
	fmt.Fprintln(out, "  pictl autopilot")
	fmt.Fprintln(out, "  pictl daybook")
	fmt.Fprintln(out, "  pictl slice pi-dev --profile meta")
	fmt.Fprintln(out, "  pictl build -- --model openai-codex/gpt-5.3-codex")
	fmt.Fprintln(out)
	fmt.Fprintln(out, "Targets:")
	for _, target := range controlplane.CanonicalTargets() {
		fmt.Fprintf(out, "  %-10s -> %-9s / %-7s %s\n", target.Name, target.Slice, target.DefaultProfile, target.Description)
	}
}

func printTargets() {
	for _, target := range controlplane.CanonicalTargets() {
		fmt.Printf("%-10s -> %-9s / %-7s (%s)\n", target.Name, target.Slice, target.DefaultProfile, target.Description)
	}
}

func printSlices(opts globalOptions) int {
	root, err := controlplane.DetermineRoot(opts.Root)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}

	slices, err := controlplane.LoadSlices(root)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}

	for _, info := range controlplane.SortedSliceInfos(slices) {
		profile := info.Manifest.DefaultProfile
		if profile == "" {
			profile = "(none)"
		}
		description := info.Manifest.Description
		if description == "" {
			description = "(no description)"
		}
		fmt.Printf("%-12s profile=%-10s extensions=%-2d %s\n", info.Name, profile, len(info.Manifest.Extensions), description)
	}

	return 0
}

func runDoctor(opts globalOptions) int {
	root, err := controlplane.DetermineRoot(opts.Root)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}

	slices, err := controlplane.LoadSlices(root)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}

	fmt.Printf("root: %s\n", root)
	fmt.Printf("targets: %d\n", len(controlplane.CanonicalTargets()))
	fmt.Printf("slices: %d\n", len(slices))
	fmt.Printf("strict default: %v\n", opts.Strict)
	if opts.Profile != "" {
		fmt.Printf("profile override: %s\n", opts.Profile)
	}
	if env := os.Getenv("PI_AGENT_CONFIG_ROOT"); env != "" {
		fmt.Printf("env PI_AGENT_CONFIG_ROOT: %s\n", env)
	}
	return 0
}

func runTarget(opts globalOptions, targetName string, forwarded []string) int {
	target, ok := controlplane.ResolveTarget(targetName)
	if !ok {
		fmt.Fprintf(os.Stderr, "error: unknown target %q\n", targetName)
		return 2
	}

	root, err := controlplane.DetermineRoot(opts.Root)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}

	slices, err := controlplane.LoadSlices(root)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}

	manifest, ok := slices[target.Slice]
	if !ok {
		fmt.Fprintf(os.Stderr, "error: target %q maps to missing slice %q\n", target.Name, target.Slice)
		return 1
	}

	profile := strings.TrimSpace(opts.Profile)
	if profile == "" {
		profile = target.DefaultProfile
	}

	spec, err := controlplane.BuildLaunchSpec(root, manifest, opts.Strict, profile, forwarded)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}

	if err := controlplane.LaunchPi(spec); err != nil {
		return exitCodeForError(err)
	}
	return 0
}

func runSlice(opts globalOptions, sliceName string, forwarded []string) int {
	root, err := controlplane.DetermineRoot(opts.Root)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}

	slices, err := controlplane.LoadSlices(root)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}

	manifest, ok := slices[sliceName]
	if !ok {
		fmt.Fprintf(os.Stderr, "error: unknown slice %q\n", sliceName)
		return 2
	}

	spec, err := controlplane.BuildLaunchSpec(root, manifest, opts.Strict, opts.Profile, forwarded)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}

	if err := controlplane.LaunchPi(spec); err != nil {
		return exitCodeForError(err)
	}
	return 0
}

func pickTargetInteractive() (string, error) {
	if !controlplane.IsTTY() {
		return "", errors.New("no target specified and no interactive TTY available")
	}

	targets := controlplane.CanonicalTargets()
	fmt.Println("Select workload target:")
	for i, target := range targets {
		fmt.Printf("%d) %-10s %s\n", i+1, target.Name, target.Description)
	}

	reader := bufio.NewReader(os.Stdin)
	for {
		fmt.Print("Choice: ")
		line, err := reader.ReadString('\n')
		if err != nil {
			return "", err
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		index, err := strconv.Atoi(line)
		if err != nil || index < 1 || index > len(targets) {
			fmt.Println("Invalid selection. Try again.")
			continue
		}

		return targets[index-1].Name, nil
	}
}

func exitCodeForError(err error) int {
	if err == nil {
		return 0
	}

	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}

	fmt.Fprintf(os.Stderr, "error: %v\n", err)
	return 1
}
