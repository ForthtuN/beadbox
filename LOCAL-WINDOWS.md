# Beadbox Local – egen Windows-version

Branch: `feature/hierarchical-windows`. Den vanliga `main`-branchen påverkas inte.

## Funktion

- Statusgrupperade uppgifter behåller hierarkin Epic → Task → Subtask → ….
- Från version **0.34.1** avslutar Windows automatiskt Beadbox-sidecaren
  när Tauri-hostprocessen avslutas eller kraschar. En Windows Job Object
  används och Beadbox startar därför **ingen PowerShell-watchdog**.
- Från version **0.34.2** kompileras Bun-sidecaren med
  `--windows-hide-console`. Det förhindrar ett separat Windows Terminal-fönster.
- Från version **0.34.3** kör Beadbox sina `bd.exe`-hämtningar med
  `windowsHide` för att förhindra kortvariga CMD-fönster vid uppstart och
  uppdatering av arbetsytor.
- Uppdateraren är avstängd i den lokala Windows-konfigurationen.

## Bygg

Kör från projektroten i PowerShell:

```powershell
pwsh -NoProfile -File scripts/build-local-windows.ps1
```

Använder installerade Rust MSVC- och Visual Studio C++-verktyg. Bun ligger
i `.tools/bun` och Rust/Bun-cache i `.cargo-home` respektive `.bun-cache`.
Inga GitHub Actions används. Installationsfilen sparas i `releases/`.

Windows kan skapa en temporär NSIS-cache under användarprofilen. Byggskriptet
tar bort den om den inte fanns redan före bygget.

## Installera uppdatering

Stäng först den redan körande Beadbox Local och kör den nya
`releases/Beadbox Local_0.34.3_x64-setup.exe`. Uppdateringen har samma
appidentitet som föregående Local-version, men högre versionsnummer.

## Verifiering 0.34.1

- Klient: 112 riktade tester godkända, TypeScript godkänt.
- Server: parent-death-watcher- och process-spawn-tester godkända.
- Rust: `cargo check` och två Windows-Job-Object-enhetstester godkända.
- Verklig Windows-smoke: app och sidecar startade, 0 skalprocesser under
  sidecaren och sidecaren dog direkt när testhosten tvångsavslutades.

Installationsfilen och lokala verktyg/cache mappar är Git-ignorerade.
