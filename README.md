# APK / IPA

## APK (Android) і Windows — автоматично на GitHub (workflow release.yml)
1. Залий проєкт у GitHub (папка `mobile/` і `.github/workflows/build-android.yml` мають бути в репозиторії).
2. Один раз: Settings → Secrets and variables → Actions → Variables → створи `SITE_URL` = адреса застосунку (https://твій-сайт.vercel.app).
3. Кожна збірка автоматично створює реліз `v1.0.N` з файлами `TrebaSvitlo.apk` і `TrebaSvitlo.exe`. Сайт завантаження сам підхоплює найновіший реліз.

## IPA (iPhone)
IPA збирається лише на Mac з Xcode і потребує Apple Developer акаунт ($99/рік):
```
cd mobile && npm install && npx cap add ios && npx cap sync ios && npx cap open ios
```
Далі в Xcode: Signing → Product → Archive → Distribute. Без Mac можна використати Codemagic / Ionic Appflow.
Без акаунта розробника на iPhone працює «Поділитися → На початковий екран» (уже підтримується).
