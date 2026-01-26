# Demo: RepoBootcamp with Sonnet --fast mode
Output media/demo-sonnet.mp4
Set FontSize 14
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Shell zsh

# Start with clean slate
Hide
Type "cd /Users/arthur/Desktop/RepoBootcamp && rm -rf /tmp/demo-output"
Enter
Sleep 500ms
Show

# Title
Type "# RepoBootcamp - Generate onboarding docs in under 1 minute"
Enter
Sleep 1.5s

# Run the command
Type "node dist/index.js https://github.com/sindresorhus/escape-string-regexp -o /tmp/demo-output --fast --model claude-sonnet-4"
Enter
Sleep 65s

# Show generated files
Type "ls -la /tmp/demo-output/"
Enter
Sleep 2s

# Show the main bootcamp doc
Type "head -60 /tmp/demo-output/BOOTCAMP.md"
Enter
Sleep 4s

Type "# Done! Full onboarding kit in under 1 minute 🚀"
Enter
Sleep 2s
