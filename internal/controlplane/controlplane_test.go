package controlplane

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveTargetAlias(t *testing.T) {
	target, ok := ResolveTarget("pidev")
	if !ok {
		t.Fatalf("expected alias to resolve")
	}
	if target.Name != "meta" {
		t.Fatalf("expected meta target, got %q", target.Name)
	}
}

func TestResolveTargetNewAliases(t *testing.T) {
	target, ok := ResolveTarget("journal")
	if !ok {
		t.Fatalf("expected journal alias to resolve")
	}
	if target.Name != "daybook" {
		t.Fatalf("expected daybook target, got %q", target.Name)
	}

	target, ok = ResolveTarget("devflow")
	if !ok {
		t.Fatalf("expected devflow alias to resolve")
	}
	if target.Name != "build" {
		t.Fatalf("expected build target, got %q", target.Name)
	}

	target, ok = ResolveTarget("ship")
	if !ok {
		t.Fatalf("expected ship alias to resolve")
	}
	if target.Name != "autopilot" {
		t.Fatalf("expected autopilot target, got %q", target.Name)
	}
}

func TestHasProfileFlag(t *testing.T) {
	if !HasProfileFlag([]string{"--profile", "meta"}) {
		t.Fatalf("expected --profile flag detection")
	}
	if !HasProfileFlag([]string{"--model", "x", "--profile=ship"}) {
		t.Fatalf("expected --profile= detection")
	}
	if HasProfileFlag([]string{"--model", "x"}) {
		t.Fatalf("did not expect profile flag")
	}
}

func TestBuildLaunchSpecSetsDefaultProfileEnv(t *testing.T) {
	root := t.TempDir()
	extDir := filepath.Join(root, "extensions")
	if err := os.MkdirAll(extDir, 0o755); err != nil {
		t.Fatal(err)
	}
	extFile := filepath.Join(extDir, "x.ts")
	if err := os.WriteFile(extFile, []byte("export default function () {}"), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest := SliceManifest{
		DefaultProfile: "meta",
		Extensions:     []string{"extensions/x.ts"},
	}

	spec, err := BuildLaunchSpec(root, manifest, true, "", []string{"--model", "foo/bar"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(spec.Args) < 6 {
		t.Fatalf("unexpected args length: %v", spec.Args)
	}

	containsStrict := false
	for _, arg := range spec.Args {
		if arg == "--no-skills" {
			containsStrict = true
			break
		}
	}
	if !containsStrict {
		t.Fatalf("expected strict no-skills arg")
	}

	foundEnv := false
	for _, entry := range spec.Env {
		if entry == "PI_DEFAULT_PROFILE=meta" {
			foundEnv = true
			break
		}
	}
	if !foundEnv {
		t.Fatalf("expected PI_DEFAULT_PROFILE env in launch spec")
	}
}

func TestBuildLaunchSpecDoesNotSetProfileWhenForwardedHasProfile(t *testing.T) {
	root := t.TempDir()
	extDir := filepath.Join(root, "extensions")
	if err := os.MkdirAll(extDir, 0o755); err != nil {
		t.Fatal(err)
	}
	extFile := filepath.Join(extDir, "x.ts")
	if err := os.WriteFile(extFile, []byte("export default function () {}"), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest := SliceManifest{
		DefaultProfile: "meta",
		Extensions:     []string{"extensions/x.ts"},
	}

	spec, err := BuildLaunchSpec(root, manifest, false, "", []string{"--profile", "ship"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for _, entry := range spec.Env {
		if entry == "PI_DEFAULT_PROFILE=meta" {
			t.Fatalf("did not expect default profile env when --profile is forwarded")
		}
	}
}
