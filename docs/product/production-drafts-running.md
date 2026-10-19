# Trwałe szkice produkcji — zadanie03

Aktualizacja: edycję i anulowanie kandydata04 opisano w
[raporcie04](production-draft-edit-running.md). Poniższy zakres i liczby
są historycznym zapisem etapu03; wykonanie i powiązanie partii nadal w05.

18.10.2026. Baza67ed431; gałąź recovery/production-drafts.
Izolowany kandydat rozwojowy podczas blokady zadania01. Natywna baza pozostaje
warunkiem odbioru i integracji; przygotowanie kodu nie zamyka tej zależności.

## Zachowanie

- Nowy typ PRODUCTION_DRAFT w istniejącym merchant_stock_operation JSONB.
  Brak zmiany struktury SQL i brak migracji: kind jest text, nie enum bazowy.
- POST /venues/:venueId/production/drafts zapisuje wersję receptury, zasób
  wyjściowy, partie, oczekiwany uzysk, powód i opcjonalny okres źródłowy UTC.
  DRAFT/revision1, aktor i czas z serwera. Nie przyjmuje actualYield ani partii.
- GET lista paginowana i GET konkretnego szkicu. Właściciel lub aktualne
  inventory.manage, izolacja venue. W szkicu nie ma cen ani kosztów receptury.
- Zapis i odpowiedź idempotencji oraz audit w jednej transakcji. Powtórzenie
  odtwarza ID, zmiana payload pod tym samym kluczem daje konflikt.
- Zero ruchów i rezerwacji: szkic można przygotować bez aktualnego pokrycia
  zapasu; dostępność musi być ponownie sprawdzona przy rzeczywistym wykonaniu.
  Walidowane receptura, wyjściowy zasób, cykle, limity partii i ilości oraz
  zakres źródła: pełne dni UTC3–90, horyzont1–30, bez przyszłości.
- Ekran zapisuje obecne założenia formularza; kopia propozycji może zachować
  okres historii. Otwarcie szkicu wypełnia pola planu, czyści faktyczny uzysk
  i dane partii. Operator wpisuje wynik pomiaru ręcznie.
- Niepewny zapis blokuje kolejny szkic i pozwala ponowić dokładny payload
  z tym samym kluczem. Zmiana konta/lokalu czyści widok; epoka efektu chroni
  także przed wynikiem starego zapisu przy zmianie API w tym samym scope.

## Granice

To wycinek03, nie wykonanie04–05: brak edycji/anulacji szkicu i powiązania
EXECUTED z partią. Otwarcie jedynie kopiuje plan; po zapisaniu partii szkic
nie jest automatycznie oznaczany jako wykonany. Nie deklarujemy całego R05
ukończonym ani odebranego telefonu. Źródło jest informacją o założeniach
planu, nie kryptograficznym dowodem obliczenia rekomendacji.

## Testy i przeglądy

Publiczne API: czerwony test brakującego endpointu, potem zielony zapis,
odczyt, retry i brak zmiany stock/produkcji. Dodatkowo izolacja lokali,
role i odebranie inventory.manage, payload actualYield/overflow, zachowanie
okresu źródłowego i odrzucenie niepełnych dni. UI: retry i dokładny payload,
ignorowanie starego konta oraz starego zapisu API, czyszczenie po403.

Ukierunkowane API9/9 w3 plikach (drafts,production,production-proposals).
Po dodatkowych asercjach source ponowiony nowy plik:2/2. Końcowe web291/291
w67 plikach, shared57/57 w8 plikach. API TypeScript i końcowy web build
zaliczone. Build ostrzega o dużym pakiecie; pomiar i podział pozostają R07.

Spec: bez blokad; dodano wskazane asercje okresu źródłowego.
Standards: bez blokad; dodatkowo zabezpieczono epokę API dla zapisu i dodano
test odtworzenia wyścigu. Odbiór niezależnych sesji PostgreSQL nadal otwarty.

Poprzednia trwała kopia całego kodu: NIMBLE-CASH-CONTRACT-FULL-CODE.zip,
libfile_ca5bc675f12081918cd471ef99217cb7. Ten etap kończy się nową pełną
kopią kodu i historii z kontrolą świeżego odtworzenia.

## Pełna regresja API
Pięć rozłącznych części:375/376 testów,74 pliki dokładnie raz, bez pominięć
i duplikatów, brak pending. Jedyny błąd: merchantNotificationPersistence.test.ts,
który wymaga natywnego połączenia PG. Wszystkie pozostałe testy zaliczone
na pomocniczym PGlite. Kod API z d25fb38; później tylko uzupełniono asercje
źródła w nowym teście i osobno zaliczono2/2. Kod UI po poprawce epoki:
pełne291/291 oraz końcowy build zaliczone. Ten wynik nie zastępuje zadania01.

## Aktualny odbiór — 19.10.2026

API test/production-drafts.test.ts: 2/2 PASS w pełnym natywnym run39246316523 (PostgreSQL16.15, pełne API401/401). UI test/production-drafts.test.tsx: 3/3 PASS w aktualnym lokalnym przebiegu18/18 dla03–09.
Niezależny audyt Spec nie znalazł luk w kryteriach ticketu. Poprzednie
opisy otwartej bramki PostgreSQL są historyczne; aktualne dowody:
native-postgres-acceptance-20261019.json/.txt i acceptance-01-09-running.md.
Brak wdrożenia i odbioru fizycznego telefonu w tym etapie.
