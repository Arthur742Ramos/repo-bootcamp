# Repo Bootcamp Demo
# Run this with: vhs media/demo.tape
# Requires: vhs (brew install vhs)

Output media/demo.gif

Set FontSize 14
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 20

# Clear screen and show title
Hide
Type "clear"
Enter
Show

Sleep 500ms

# Show the command with a comment first
Type "# Repo Bootcamp - Turn any repo into Day 1 onboarding docs"
Sleep 1s
Enter
Sleep 500ms

Type "npx repo-bootcamp https://github.com/sindresorhus/ky"
Sleep 500ms
Enter

# Wait for the tool to complete
# Adjust this timing based on actual runtime - typically 30-60 seconds
Sleep 45s

# Show the generated files
Sleep 1s
Type "ls -la bootcamp-ky/"
Sleep 300ms
Enter
Sleep 2s

# Preview the main bootcamp file
Type "head -40 bootcamp-ky/BOOTCAMP.md"
Sleep 300ms
Enter
Sleep 4s

# Show a closing message
Type "# Start here: bootcamp-ky/BOOTCAMP.md"
Enter
Sleep 2s
