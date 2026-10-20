# Zadanie04 — edycja i anulowanie szkiców

Aktualizacja05: wykonanie i powiązanie partii opisano w
[raporcie05](production-draft-execute-running.md). Poniższe granice i wyniki
są historycznym zapisem etapu04.

18.10.2026, baza041a1d2, gałąź recovery/production-drafts.
Osobny kandydat rozwojowy; zależny natywny odbiór01 pozostaje otwarty.

## Zachowanie

PATCH /venues/:venueId/production/drafts/:id przyjmuje plan, oczekiwaną
rewizję i idempotencyKey. POST .../:id/cancel przyjmuje rewizję, powód
i klucz. Każda mutacja: inventoryRetry, FOR UPDATE na szkicu, sprawdzenie
lokalu, typu, statusu DRAFT i rewizji. Sukces zwiększa rewizję o1.
Anulowanie zapisuje CANCELLED, powód, aktora i czas serwera. Metadata
utworzenia zachowana; audit zapisuje stan przed/po. Zero ruchów zapasu.

Plany historyczne z rewizją1 nadal są zgodne. Rozszerzenie danych JSONB
nie wymaga migracji DDL. Nowe kody409: DRAFT_REVISION_CONFLICT i
DRAFT_NOT_EDITABLE, z komunikatami polskimi. Użyto tego samego kontekstu
bieżących uprawnień owner/inventory.manage; koszty nie są ujawniane.

## Interfejs

Edycja kopiuje wybrany szkic do istniejącego formularza i czyści actualYield.
Zapis zmian kieruje do PATCH, zamiast utworzyć kolejny szkic. Po konflikcie
formularz i oczekiwana rewizja są zachowane. Odświeżenie listy lub wybranego
szkicu pokazuje aktualne wartości do porównania. Osobna akcja przyjęcia
najnowszej rewizji zachowuje wpisane pola; następny zapis używa nowej rewizji.
Stara lub anulowana rewizja blokuje przycisk zapisu. Historia anulowania
pozostaje na liście, bez przycisków otwarcia/edycji.

Anulowanie wymaga wpisania powodu i jawnego zatwierdzenia. Niepewna
mutacja zachowuje dokładny method/path/body/key i blokuje inne zapisy;
retry nie rekonstruuje body z aktualnie zmienionych pól. Zmiana API/konta/
lokalu unieważnia spóźnione odpowiedzi. Zmiana liczby partii, otwarcie planu
i mutacja szkicu unieważniają poprzedni podgląd propozycji; wymagana nowa
kalkulacja. Aktualna wykonalność nie jest zamrażana w szkicu.

## Testy i przeglądy

API red: brak PATCH, następnie green. Ukierunkowane API11/11 w4 plikach;
edycja, ten sam klucz, konflikt, anulowanie, idempotentne anulowanie,
obcy lokal, dwa żądania tej samej rewizji, terminalny status i brak ruchów.
Promise.all na PGlite nie dowodzi niezależnych sesji PostgreSQL.
UI8/8 w4 plikach przed rozszerzeniem przypadku konfliktu; rozszerzony test
osobno1/1 i następnie pełny web292/292 w68 plikach. Shared57/57 w8 plikach.
API tsc oraz końcowy web build zaliczone. Build nadal ostrzega o wielkości
pakietu; pomiary i odchudzenie pozostają w R07.

Standards: brak blokad. Spec: wykryto pułapkę stale revision po odświeżeniu;
naprawiono przez jawną adopcję rewizji i zachowanie formularza. Ponowny
przegląd a11a4d6 potwierdził brak pozostałych blokad.

## Granice

Wykonanie szkicu i powiązanie EXECUTED/batchId pozostają zadaniem05.
Nie oznaczono wdrożenia ani odbioru natywnego/telefonu. Poprzednia pełna
trwała kopia: NIMBLE-PRODUCTION-DRAFTS-FULL-CODE.zip,
libfile_4b9053a9986881919db17632bb86d2ee. Po tym etapie powstaje nowa
pełna kopia kodu i historii z kontrolą świeżego odtworzenia.

## Końcowa regresja API
Wszystkie75 plików, dokładnie raz, bez pominięć/duplikatów i bez pending:
377/378. Jedyny błąd: merchantNotificationPersistence.test.ts, wymagający
natywnego PG. PGlite nie zastępuje odbioru blokad i niezależnych sesji.
Pełny przebieg API dotyczy9d2d167; późniejszy a11a4d6 zmienia wyłącznie UI
i jego test, po czym pełny web292/292 i build ponowiono z sukcesem.

## Aktualny odbiór — 19.10.2026

API test/production-draft-edit.test.ts: 2/2 PASS w pełnym natywnym run39246316523 (PostgreSQL16.15, pełne API401/401). UI test/production-draft-edit.test.tsx: 1/1 PASS w aktualnym lokalnym przebiegu18/18 dla03–09.
Niezależny audyt Spec nie znalazł luk w kryteriach ticketu. Poprzednie
opisy otwartej bramki PostgreSQL są historyczne; aktualne dowody:
native-postgres-acceptance-20261019.json/.txt i acceptance-01-09-running.md.
Brak wdrożenia i odbioru fizycznego telefonu w tym etapie.
