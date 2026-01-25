# Demo Recording

This directory contains media assets for the README.

## Generating the Demo GIF

### Option 1: Using VHS (Recommended)

[VHS](https://github.com/charmbracelet/vhs) creates beautiful terminal recordings.

```bash
# Install VHS
brew install vhs

# Record the demo
vhs media/demo.tape
```

### Option 2: Using asciinema + agg

```bash
# Install tools
brew install asciinema
brew install agg

# Record
asciinema rec demo.cast

# Convert to GIF
agg demo.cast demo.gif
```

## VHS Tape File

Create `media/demo.tape`:

```tape
Output demo.gif

Set FontSize 14
Set Width 1200
Set Height 600
Set Theme "Catppuccin Mocha"

Type "bootcamp https://github.com/sindresorhus/ky --verbose"
Sleep 500ms
Enter

Sleep 65s

Type "cat bootcamp-ky/BOOTCAMP.md | head -50"
Sleep 500ms
Enter

Sleep 3s
```

## Quick Demo Script

For a quick demo without waiting for full generation:

```bash
# Use --json-only for faster demo (skips markdown generation)
bootcamp https://github.com/sindresorhus/ky --json-only --verbose
```
