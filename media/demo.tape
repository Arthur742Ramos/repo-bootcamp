# Repo Bootcamp Demo
# Run this with: vhs media/demo.tape

Output media/demo.gif

Set FontSize 14
Set Width 1200
Set Height 600
Set Theme "Catppuccin Mocha"
Set Padding 20

# Show the command
Type "# Repo Bootcamp - Turn any repo into a Day 1 onboarding kit"
Sleep 1s
Enter
Sleep 500ms

Type "bootcamp https://github.com/sindresorhus/ky"
Sleep 500ms
Enter

# Wait for the tool to complete (adjust based on actual runtime)
Sleep 60s

# Show the output
Type "ls bootcamp-ky/"
Sleep 500ms
Enter
Sleep 2s

Type "head -30 bootcamp-ky/BOOTCAMP.md"
Sleep 500ms
Enter
Sleep 3s
