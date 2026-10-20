# Plan wykonawczy Nimble — zadania dla modeli o mniejszej zdolności rozumowania

**Aktualizacja20.10.2026:**01 ponownie zaliczony po odtworzeniu i naprawie
zakleszczenia POS/remote/nagroda. Poprawka a89cbdb: focused1/1, API401/401,
UI raportów7/7 w run39477296697. Dowody native-postgres-acceptance-20261020.json/.txt.
10 zaliczony w run39480374937: full-day1/1, wszystkie10etapów PASS.
11 i12 są ready-for-agent, ich własne kryteria pozostają otwarte.
Dowody: full-day-acceptance-20261020.json/.txt.
Historyczny odbiór19.10.2026:01–09 zaliczony; natywne API401/401
w79 plikach i aktualne testy UI modułów. Macierz i dokładne źródła:
[acceptance-01-09-running.md](acceptance-01-09-running.md).
Scenariusz10 uruchomiony przez pipeline po natywnym API i ekranach raportów;
jego wynik pozostaje osobnym odbiorem. Poniższy opis startowego stanu planu
i blokady01 jest historyczny.

18.10.2026, baza1095cf9. Przygotowano 30 osobnych ticketów: 25 wykonawczych/odbiorowych oraz 5
projektowo-decyzyjnych. Późniejsze integracje zależne od decyzji wymagają
dalszego podziału po zamknięciu ich kontraktów.
Każdy ticket ma jedną personę/cel, zależności, zakres, przykłady,
kryteria, źródła kodu, weryfikację i format przekazania.

Plan rozszerza R03–R09 i U00–U10; nie zastępuje niezakończonych kryteriów MM/PL.
Źródło instrukcji wykonawcy: [README trackera](../../.scratch/nimble-next/README.md).
Tracker lokalny: .scratch/nimble-next/issues, po jednym pliku na zadanie.
Nie opublikowano issues na GitHub. Rozpoczęto realizację:01 potwierdzone blocked środowiskowo, kontrakt06 przygotowany i przejrzany niezależnie; zadanie07 ma kandydat sprzedaży gotówkowej z UI, odzyskiwaniem i testami, bez wdrożenia i natywnego odbioru. Zadanie08 dodaje osobne raportowanie CASH/CRYPTO i snapshoty zamknięcia dnia; raport cash-report-running.md. Zadania03–05 mają izolowany kandydat szkiców z edycją, anulowaniem i atomowym wykonaniem na osobnej gałęzi, bez natywnego odbioru.
Zachowano wcześniejszą zgodę na autonomiczne przygotowanie zadań; bez
dodatkowej rundy zatwierdzania samej ich redakcji.

## Jak wybierać zadanie
Pracuj po zależnościach. Numeracja jest zalecaną kolejnością; 03 i06 mogą
powstawać niezależnie po01, 12 równolegle z11, 24 po16 bez czekania na API.
Przy tworzeniu planu01 był blocked; implementacje dziedziczyły zależności. Dopuszczono niezależne przygotowanie projektowego kontraktu06 podczas tej blokady. Natywny odbiór07–09 zaliczono19.10; patrz aktualizacja powyżej.
Nie oznaczono wszystkich sztucznie jako ready-for-agent.

## Podział pracy według ryzyka
- Model mniejszy: dokumentacja/przykład20, profil24, UI12, wąskie szkice03–04
  po kontrakcie i testach. Jedno zadanie na kontekst, nie cały plan naraz.
- Wysokie ryzyko: pieniądze, migracje, uprawnienia, webhooki i współbieżność.
  Można delegować implementację, ale niezależny mocniejszy przegląd jest bramką.
- Projekty06/26 oraz decyzje25/29/30 zamykają niepewności przed kodem.
  Kolejnych ticketów integracji SMS, weryfikacji firmy i opłat nie udajemy
  gotowymi do kodowania przed wyborem dostawcy/procedury/modelu cenowego.

## Kolejka
| ID | Zadanie | Zależności | Rodzaj/ryzyko |
|---|---|---|---|
| 01 | [Natywna baza: dowód działania obecnego kodu](../../.scratch/nimble-next/issues/01.md) | środowisko PG | środowisko |
| 02 | [Odbiór kosztów i marży na natywnej bazie](../../.scratch/nimble-next/issues/02.md) | 01 | wysokie |
| 03 | [Zapis i ponowne otwarcie szkicu produkcji](../../.scratch/nimble-next/issues/03.md) | 01 | średnie |
| 04 | [Edycja i anulowanie szkicu produkcji](../../.scratch/nimble-next/issues/04.md) | 03 | średnie |
| 05 | [Realizacja szkicu produkcji dokładnie raz](../../.scratch/nimble-next/issues/05.md) | 04 | wysokie |
| 06 | [Projekt kontraktu sprzedaży gotówkowej](../../.scratch/nimble-next/issues/06.md) | 01 | projekt |
| 07 | [Gotówka: kompletna sprzedaż przy kasie](../../.scratch/nimble-next/issues/07.md) | 06 | wysokie |
| 08 | [Gotówka w raporcie i zamknięciu dnia](../../.scratch/nimble-next/issues/08.md) | 07 | wysokie |
| 09 | [Pełny zwrot sprzedaży gotówkowej](../../.scratch/nimble-next/issues/09.md) | 08 | wysokie |
| 10 | [Pełny dzień lokalu w przeglądarce](../../.scratch/nimble-next/issues/10.md) | 02, 05, 09 | wysokie |
| 11 | [Awarie i odebranie praw w aktywnej sesji](../../.scratch/nimble-next/issues/11.md) | 10 | wysokie |
| 12 | [Odbiór mobilny i kompletność komunikatów](../../.scratch/nimble-next/issues/12.md) | 10 | średnie |
| 13 | [Pomiar i poprawa wydajności telefonu](../../.scratch/nimble-next/issues/13.md) | 12 | średnie |
| 14 | [Odtworzenie bazy i zdjęć do pustej instancji](../../.scratch/nimble-next/issues/14.md) | 11 | środowisko |
| 15 | [Migracja wcześniejszych danych i powrót aplikacji](../../.scratch/nimble-next/issues/15.md) | 14 | wysokie |
| 16 | [Kandydat HTTPS i strona statusu](../../.scratch/nimble-next/issues/16.md) | 11, 13, 15 | środowisko |
| 17 | [Odbiór NIM i USDT w Nimiq Pay](../../.scratch/nimble-next/issues/17.md) | 16 | środowisko |
| 18 | [Klucze Merchant API: utworzenie i odwołanie](../../.scratch/nimble-next/issues/18.md) | 16 | wysokie |
| 19 | [Publiczne wystawienie i odczyt rachunku](../../.scratch/nimble-next/issues/19.md) | 18 | wysokie |
| 20 | [Przykładowa integracja sklepu i sandbox](../../.scratch/nimble-next/issues/20.md) | 19 | średnie |
| 21 | [Webhook: konfiguracja i dostarczenie zdarzenia](../../.scratch/nimble-next/issues/21.md) | 19 | wysokie |
| 22 | [Webhook: retry i ręczne ponowienie](../../.scratch/nimble-next/issues/22.md) | 21 | wysokie |
| 23 | [Dobrowolny napiwek do sprzedaży](../../.scratch/nimble-next/issues/23.md) | 17 | wysokie |
| 24 | [Deklarowany profil firmy](../../.scratch/nimble-next/issues/24.md) | 16 | średnie |
| 25 | [Procedura weryfikacji firmy — decyzja przed kodem](../../.scratch/nimble-next/issues/25.md) | 24 | decyzja |
| 26 | [Kontrakt podziału rachunku](../../.scratch/nimble-next/issues/26.md) | 17 | projekt |
| 27 | [Podział rachunku: płatności udziałów](../../.scratch/nimble-next/issues/27.md) | 26 | wysokie |
| 28 | [Podział rachunku: awarie i zwroty](../../.scratch/nimble-next/issues/28.md) | 27 | wysokie |
| 29 | [Telefon i SMS — projekt oraz wybór dostawcy](../../.scratch/nimble-next/issues/29.md) | 17 | decyzja |
| 30 | [Opłaty platformy — kontrakt rozliczeń](../../.scratch/nimble-next/issues/30.md) | 20 | decyzja |

## Pełny zakres oraz granice
01–05: baza, ekonomia i szkice;06–09: gotówka;10–17: pełny odbiór wersji,
telefon, wydajność, restore i hosting;18–22: Merchant API i webhooki;
23–25: napiwki i profil;26–28: rachunek dzielony;29: telefon/SMS;
30: rozliczanie opłat. Status usługi jest w16.

05 zamyka lukę trwałego planu produkcji. U02 zawiera też kontrolę pozycji
jednorazowych, archiwizacji i raportów produkt/kasjer: przed16 sporządzić
macierz kompletności i nowe wąskie tickety dla rzeczywiście znalezionych luk.
Nie deklarujemy ich wdrożenia ani zerowego nakładu bez sprawdzenia.

AI-01 nadal odłożone. Cashlinks poza zakresem. Wspólny telefon lokalu zostaje.
Kopie całego kodu i historii są obowiązkiem wykonawcy, nie właściciela.

Zadanie09 ma kandydata pełnego zwrotu gotówki (request kasjera/owner physical confirm), raporty i historyczne wypłaty bez zmiany. Raport cash-refund-running.md. Natywny odbiór nadal otwarty; kolejne10.
