# Instrukcja wykonania jednego zadania

Baza planu: 1095cf9, 18.10.2026. To plan, nie wykonanie funkcji.
Wykonuj jeden ticket z issues/ naraz. Przeczytaj go w całości, ten plik,
GLOSSARY.md i wskazane źródła. Następnie sprawdź aktualny HEAD i stan repo.
Ścieżki są punktami startu na tej bazie, nie nakazem tworzenia identycznego
pliku po refaktorze; jeśli ścieżka nie istnieje, znajdź symbol przez rg.

## Kolejność pracy
1. Sprawdź Blocked by i dowody zakończenia poprzedników. Sam status dokumentu
   nie zastępuje testu. Przy blokadzie środowiska zapisz dokładny brak.
2. Odtwórz przepływ istniejący w kodzie i dopisz krótki plan zmian. W zadaniu
   projektowym dostarcz kontrakt, a nie kod funkcji. Nie projektuj na nowo
   zasad ustalonych przez poprzednika.
3. Dla zmiany zachowania dodaj test użytkowego przypadku i odtwórz brak
   funkcji/błąd. Zaimplementuj pełny wskazany wycinek UI/API/danych.
4. Uruchom testy wskazane w tickecie oraz typy/build przy zmianie kontraktu
   lub UI. Testy pieniężne, role i współbieżność muszą objąć przypadki błędne.
5. Przejrzyj diff ze specyfikacją i standardami. Zmiany oznaczone wysokie
   lub projekt wymagają niezależnego przeglądu przez mocniejszy model/osobę
   przed integracją. Słabszy wykonawca nie może sam zastąpić tej bramki.
6. Uzupełnij Wynik: SHA, zmienione pliki, dokładne komendy, pass/fail/skip,
   niewykonane kryteria i ograniczenia. Commit tylko plików zadania.
7. Zrób pełny checkpoint przez scripts/checkpoint-code.py do nowej ścieżki
   poza repo. Potwierdź świeże odtworzenie oraz trwały zapis całego archiwum.
   Zachowaj ID kopii i SHA256 w raporcie kontynuacji. Użytkownik nie przechowuje
   kodu i nie wykonuje pushów. Brak trwałego zapisu blokuje status completed.

## Stałe reguły produktu
- Wspólny telefon lokalu, konta/PIN pracowników; właściciel kontroluje portfel.
- API sprawdza aktualne uprawnienia i venueId; UI nie jest zabezpieczeniem.
- Kwoty fiat jako integer minor units, crypto atomic jako bigint/string;
  żadnych obliczeń pieniężnych przez zmiennoprzecinkowe przybliżenia.
- Powtórzona operacja nie dubluje dokumentów i ruchów; inny payload pod tym
  samym kluczem daje konflikt. Zapisz klucz przed wysłaniem, zachowaj po timeout.
- NIM/USDT są aktywami; gotówka jest metodą zapłaty. Snapshot ceny i kosztu
  nie zmienia się po edycji katalogu. Nieznane dane pozostają nieznane.
- Migracje addytywne, bez kasowania historii i starych kopii. Każda poprawka
  finansowa jest śladem operacji, nie usunięciem dokumentu.
- Przed wysyłką/replay sprawdź lokal i uprawnienia. Opóźnione odpowiedzi po
  zmianie konta/lokalu nie mogą odtworzyć starego widoku.
- Testy używają dedykowanych baz. Zgoda na reset dotyczy wyłącznie sprawdzonej
  testowej instancji; nigdy nie obchodź osłon runnera ani kontroli dostępu.
- AI-01 jest odłożone. Cashlinks poza zakresem. Publiczne wdrożenie, prawdziwe
  przelewy i koszty usług nie są skutkiem samego ukończenia ticketu.

## Komendy i dowody
Uruchamiaj z korzenia repo, pnpm9.15.0 przez corepack. Konfiguracja package.json
jest źródłem prawdy; przy zmianie skryptów odnotuj nową komendę.
```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @nimble/api exec tsc --noEmit
corepack pnpm --filter @nimble/web build
corepack pnpm --filter @nimble/shared test
corepack pnpm --filter @nimble/web test
node --test scripts/test-backup.test.mjs scripts/test-native-postgres.test.mjs
```
Natywna baza: po skonfigurowaniu runnera zgodnie z zadaniem01:
`node scripts/test-native-postgres.mjs test/NAZWA.test.ts` lub bez argumentu
do pełnego API. NATIVE_POSTGRES_TEST_URL i zgoda na reset ustawiane tylko
dla dedykowanej testowej instancji; poświadczeń nie umieszczaj w dokumentach.
Pomocniczo: `corepack pnpm --filter @nimble/api exec vitest run --config
vitest.pglite.config.ts test/NAZWA.test.ts`. Ten wynik nie zastępuje PG.
UI: `corepack pnpm --filter @nimble/web exec vitest run test/NAZWA.test.tsx`.
E2E: `corepack pnpm --filter @nimble/e2e test NAZWA.spec.ts` po uruchomieniu
izolowanego PostgreSQL dla e2e/playwright.config.ts. Demo/mock nie zalicza
rzeczywistego telefonu lub łańcucha. Pełna regresja na granicy wydania,
ukierunkowana po każdym tickecie; nie przedstawiaj starego wyniku jako nowego.

## Statusy i reguła STOP
ready-for-agent = brak otwartych zależności i dostępne wymagane zasoby.
blocked = zależności/środowisko/decyzja; in-progress = wykonanie;
review = wykonane, czeka na przegląd; completed = kryteria, testy, przegląd
i trwała kopia potwierdzone. Niewykonany test nie jest zaliczony.
Jeśli kontrakt poprzednika nie określa skutku finansowego lub uprawnienia,
zapisz konkretną lukę i zatrzymaj zależną część. Wykonaj niezależne kontrole.
Nie proś ponownie o rutynowe wybory już określone w tym planie.

## Prompt uruchomienia
„Wykonaj tylko ticket NN z .scratch/nimble-next/issues/. Przeczytaj README
tego trackera i źródła ticketu. Sprawdź zależności. Zastosuj implement,
tdd dla logiki finansowej/stanów, code-review przed zamknięciem. Nie wykonuj
następnego ticketu. Zakończ dowodami testów, listą ograniczeń i trwałą kopią.”
