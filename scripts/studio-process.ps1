Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -or $_.Name -like 'Ekko*' } |
  Select-Object ProcessId, Name, CommandLine |
  Format-List
