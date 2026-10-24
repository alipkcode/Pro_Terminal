import type { ShellFamily } from './types'

// Ready-made scripts for folder actions. Each one works on the items of the folder it runs in, so the same
// script also works as a snippet (in the current folder). They skip the action file itself through
// PT_ACTION_FILE, which folder actions set while they run, and leave hidden files alone.

export interface ActionPreset {
  key: string
  name: string
  description: string
  shell: ShellFamily
  script: string
  /** Suggested scope: true when the script is most useful in every subfolder too. */
  recursive: boolean
  color: string
}

/**
 * The shared part of the rename presets: applies $rename to every name here and keeps file extensions.
 * Skips a rename when the new name is taken, and handles case-only renames (Windows needs two steps).
 */
const RENAME_LOOP = String.raw`
Get-ChildItem -LiteralPath . -File:$filesOnly | Where-Object { $_.FullName -ne $env:PT_ACTION_FILE } | ForEach-Object {
  $ext = if ($_.PSIsContainer) { '' } else { $_.Extension }
  $base = $_.Name.Substring(0, $_.Name.Length - $ext.Length)
  $new = ([string](& $rename $base)).Trim() + $ext
  if ($new -ceq $_.Name -or $new -eq $ext) { return }
  if ($new -ine $_.Name -and (Test-Path -LiteralPath $new)) { Write-Host "  skipped $($_.Name) - $new already exists" -ForegroundColor Yellow; return }
  $from = $_.FullName
  if ($new -ieq $_.Name) { Rename-Item -LiteralPath $from -NewName "$new.~pt"; $from = "$new.~pt" }
  Rename-Item -LiteralPath $from -NewName $new
  Write-Host "  $($_.Name)  ->  $new"
}`

function renamePreset(p: Omit<ActionPreset, 'script' | 'shell'> & { setup?: string; rename: string; filesOnly?: boolean }): ActionPreset {
  const { setup, rename, filesOnly, ...rest } = p
  const head = [
    `# ${p.description}`,
    '# Change the lines below to adjust it. Extensions (.mkv, .exe...) are never touched.',
    ...(setup ? [setup] : []),
    `$filesOnly = ${filesOnly ? '$true' : '$false'}`,
    `$rename = { param($name) ${rename} }`
  ]
  return { ...rest, shell: 'powershell', script: head.join('\n') + '\n' + RENAME_LOOP }
}

export const ACTION_PRESETS: ActionPreset[] = [
  renamePreset({
    key: 'remove-dashes',
    name: 'Remove dashes from names',
    description: 'Removes every "-" from the names of the files and folders here.',
    rename: String.raw`$name -replace '-', ''`,
    recursive: false,
    color: '#3b9dff'
  }),
  renamePreset({
    key: 'remove-dots',
    name: 'Remove dots from names',
    description: 'Removes every "." from names, except the dot before a file extension.',
    rename: String.raw`$name -replace '\.', ''`,
    recursive: false,
    color: '#22d3ee'
  }),
  renamePreset({
    key: 'dots-to-spaces',
    name: 'Dots to spaces',
    description: 'Turns "The.Movie.2024.mkv" into "The Movie 2024.mkv". The extension dot stays.',
    rename: String.raw`($name -replace '\.', ' ') -replace '\s{2,}', ' '`,
    recursive: false,
    color: '#34d399'
  }),
  renamePreset({
    key: 'underscores-to-spaces',
    name: 'Underscores to spaces',
    description: 'Replaces every "_" in names with a space.',
    rename: String.raw`($name -replace '_', ' ') -replace '\s{2,}', ' '`,
    recursive: false,
    color: '#a3e635'
  }),
  renamePreset({
    key: 'tidy-spaces',
    name: 'Tidy up spaces',
    description: 'Trims spaces at the start and end of names and squeezes double spaces into one.',
    rename: String.raw`$name -replace '\s{2,}', ' '`,
    recursive: false,
    color: '#94a3b8'
  }),
  renamePreset({
    key: 'find-replace',
    name: 'Find and replace in names',
    description: 'Replaces a piece of text in every name (case-sensitive). Set $find and $replaceWith first.',
    setup: "$find = 'old text'\n$replaceWith = 'new text'",
    rename: String.raw`$name.Replace($find, $replaceWith)`,
    recursive: false,
    color: '#8b7bff'
  }),
  renamePreset({
    key: 'prefix-suffix',
    name: 'Add a prefix or suffix',
    description: 'Adds text before and/or after every file name. Set $prefix and $suffix first.',
    setup: "$prefix = ''\n$suffix = ''",
    rename: String.raw`"$prefix$name$suffix"`,
    filesOnly: true,
    recursive: false,
    color: '#d946ef'
  }),
  renamePreset({
    key: 'title-case',
    name: 'Title Case names',
    description: 'Turns "my holiday photos.jpg" into "My Holiday Photos.jpg".',
    rename: String.raw`(Get-Culture).TextInfo.ToTitleCase($name.ToLower())`,
    recursive: false,
    color: '#f472b6'
  }),
  {
    key: 'lowercase-extensions',
    name: 'Lowercase extensions',
    description: 'Turns ".JPG" and ".Mp4" into ".jpg" and ".mp4".',
    shell: 'powershell',
    recursive: false,
    color: '#fbbf24',
    script: String.raw`# Turns ".JPG" and ".Mp4" into ".jpg" and ".mp4".
Get-ChildItem -LiteralPath . -File | Where-Object { $_.FullName -ne $env:PT_ACTION_FILE -and $_.Extension -cne $_.Extension.ToLower() } | ForEach-Object {
  $new = $_.BaseName + $_.Extension.ToLower()
  Rename-Item -LiteralPath $_.FullName -NewName "$new.~pt"
  Rename-Item -LiteralPath "$new.~pt" -NewName $new
  Write-Host "  $($_.Name)  ->  $new"
}`
  },
  {
    key: 'sort-by-type',
    name: 'Sort files into folders by type',
    description: 'Moves files into Images, Videos, Audio, Documents, Archives and Programs folders.',
    shell: 'powershell',
    recursive: false,
    color: '#fb923c',
    script: String.raw`# Moves files into folders by type. Edit the lists to add extensions or folders.
$types = [ordered]@{
  Images    = 'jpg jpeg png gif webp bmp heic svg tif tiff'
  Videos    = 'mp4 mkv avi mov wmv webm m4v flv'
  Audio     = 'mp3 wav flac aac ogg m4a wma opus'
  Documents = 'pdf doc docx xls xlsx ppt pptx txt rtf odt csv md epub'
  Archives  = 'zip rar 7z tar gz bz2 xz iso'
  Programs  = 'exe msi msix appx'
}
Get-ChildItem -LiteralPath . -File | Where-Object { $_.FullName -ne $env:PT_ACTION_FILE } | ForEach-Object {
  $ext = $_.Extension.TrimStart('.').ToLower()
  $folder = $types.Keys | Where-Object { ($types[$_] -split ' ') -contains $ext } | Select-Object -First 1
  if (-not $folder) { return }
  if (Test-Path -LiteralPath (Join-Path $folder $_.Name)) { Write-Host "  skipped $($_.Name) - already in $folder" -ForegroundColor Yellow; return }
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  Move-Item -LiteralPath $_.FullName -Destination $folder
  Write-Host "  $($_.Name)  ->  $folder\"
}`
  },
  {
    key: 'delete-empty-folders',
    name: 'Delete empty folders',
    description: 'Deletes empty subfolders. With "every subfolder" on, nested empty folders go too.',
    shell: 'powershell',
    recursive: true,
    color: '#f43f5e',
    script: String.raw`# Deletes subfolders that are completely empty (a hidden file counts as content).
Get-ChildItem -LiteralPath . -Directory | Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force | Select-Object -First 1) } | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName
  Write-Host "  deleted $($_.Name)\"
}`
  },
  {
    key: 'delete-junk',
    name: 'Delete Thumbs.db and Mac leftovers',
    description: 'Deletes Thumbs.db, .DS_Store and "._" files that Windows and macOS leave behind.',
    shell: 'powershell',
    recursive: true,
    color: '#94a3b8',
    script: String.raw`# Deletes Thumbs.db, .DS_Store and "._" files.
Get-ChildItem -LiteralPath . -File -Force | Where-Object { $_.Name -in 'Thumbs.db', '.DS_Store' -or $_.Name -like '._*' } | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Force
  Write-Host "  deleted $($_.Name)"
}`
  },
  {
    key: 'extract-zips',
    name: 'Extract every .zip',
    description: 'Extracts each .zip file into a folder with the same name.',
    shell: 'powershell',
    recursive: false,
    color: '#fbbf24',
    script: String.raw`# Extracts each .zip here into a folder named after it. Existing folders are skipped.
Get-ChildItem -LiteralPath . -File -Filter *.zip | ForEach-Object {
  $dest = Join-Path (Get-Location).ProviderPath $_.BaseName
  if (Test-Path -LiteralPath $dest) { Write-Host "  skipped $($_.Name) - $($_.BaseName) already exists" -ForegroundColor Yellow; return }
  Expand-Archive -LiteralPath $_.FullName -DestinationPath $dest
  Write-Host "  $($_.Name)  ->  $($_.BaseName)\"
}`
  },
  {
    key: 'git-pull-all',
    name: 'Git pull every repository',
    description: 'Runs "git pull" in each folder that is a Git repository. Best with "every subfolder".',
    shell: 'powershell',
    recursive: true,
    color: '#34d399',
    script: String.raw`# Runs "git pull" where there is a Git repository.
if (Test-Path -LiteralPath .git) {
  Write-Host "  git pull in $((Get-Location).ProviderPath)"
  git pull --ff-only
}`
  },
  {
    key: 'list-contents',
    name: 'Save a list of the contents',
    description: 'Writes the names of everything here into "_contents.txt".',
    shell: 'cmd',
    recursive: false,
    color: '#3b9dff',
    script: 'dir /b /o:gn > "_contents.txt"'
  },
  {
    key: 'copy-names',
    name: 'Copy names to the clipboard',
    description: 'Copies the names of everything here to the clipboard, one per line.',
    shell: 'cmd',
    recursive: false,
    color: '#8b7bff',
    script: 'dir /b /o:gn | clip'
  },
  {
    key: 'git-status-all',
    name: 'Git status of every repository',
    description: 'Shows the branch and changed files of each Git repository. Best with "every subfolder".',
    shell: 'cmd',
    recursive: true,
    color: '#22d3ee',
    script: 'if exist .git\\ git status --short --branch'
  }
]

/** The snippet group the presets are added to. */
export const ACTION_PRESET_GROUP = 'Folder actions'
/** Bump to add presets that were added later (each pack is added once). */
export const ACTION_PRESET_PACK = 'folder-actions-1'
