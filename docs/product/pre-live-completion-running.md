# Realizacja planu przed telefonem

2026-10-16. Gałąź integracyjna feat/merchant-management.

Zintegrowano lokalnie PL-01,05,07,09,10,11,12,13. Pełna regresja kodu produkcyjnego w commicie708cdc0: API306/306 na PGlite, web256/256, shared52/52 — razem614/614. TypeScript API/web, build produkcyjny i zgodność snapshotu Drizzle ze schematem przechodzą. Osłony runnera natywnego PostgreSQL:2/2. Główny pakiet JS przekracza500kB i pozostaje do pomiaru/odchudzenia w PL-23.

PL-02: runner i osłony wykonane; odbiór natywny pozostaje otwarty. PostgreSQL nie uruchamia initdb jako root, a kontener mapuje tylko UID/GID0. Nie wykonano natywnych testów API. Jest ścieżka do jawnie wskazanej osobnej bazy testowej.

PL-13 scalono: ewidencja pracy i przerw, korekty z zatwierdzeniem. API3/UI2 i typy zaliczone; dodatkowy zintegrowany przebieg sześciu nowych modułów API12/12. Inne zadania planu pozostają otwarte; nie oznacza to gotowości do telefonu ani wdrożenia.

Zaktualizowano ciąg snapshotów Drizzle po scaleniu migracji z osobnych gałęzi: snapshot0032 obejmuje scalone moduły menu/rabatów,0034 ewidencję pracy, a finalny0035 skaner wpłat; ostatni snapshot odpowiada łącznemu schematowi. Migracje28–32 mają rosnące znaczniki czasu; porządek29/30/31 zachowano także przy wcześniejszym scaleniu31.

## Przegląd integracji

Testy odtworzyły i zabezpieczyły trzy błędy harmonogramu: nowa wycena starego nieopłaconego koszyka POS po pauzie, brak propagacji składowej do zestawu oraz niezamierzone zamknięcie pozostałych dat przy jednym wyjątku. Poprawiono próg rabatu przy zaokrągleniu połowy grosza; test wykazał wcześniej niepotrzebną zgodę przy dokładnie dozwolonych12,5% od300groszy (38groszy). Poprawiono też typ daty kursora historii przekazania w SQL. Test uprawnień dostosowano do faktycznie wdrożonych praw time.manage i discounts.apply. Po poprawkach 15/15 ukierunkowanych testów API, a pełny web254/254. Pełne API po zmianach przeszło w końcowej regresji opisanej powyżej.

## Weryfikacja w prawdziwej przeglądarce

Chromium + rzeczywiste API + izolowany PGlite, adapter portfela/łańcucha testowy. Nowy scenariusz publikuje sfotografowane menu z zatwierdzonymi alergenami i tłumaczeniem, publikuje grafik właściciela, zapisuje przekazanie oraz rejestruje pracę/przerwę/zakończenie kasjera bez otwartej zmiany kasowej. Wąskie widoki320/390/736/1280px sprawdzają brak poziomego przepełnienia ekranu przekazania.

Test najpierw wykrył brak PUT w CORS, następnie brak dostępnego grafiku właściciela i używanie w nim klienta z tokenem kasjera. Poprawki zabezpieczono testem preflightu i jawnym wyborem tożsamości w kliencie. Po poprawkach **9/9 E2E**: cztery istniejące procesy P2P na fake-chain, cztery scenariusze demo remote i jeden nowy proces z rzeczywistym API. Nie oznacza to testu fizycznego telefonu ani realnej sieci blockchain.

Zintegrowane lokalnie zadania wykonawcze: PL-01,05,07,09,10,11,12,13. PL-02 pozostaje acceptance-blocked; pozostałe16 zadań ma bezpośrednią lub przechodnią zależność od tej bramki. Nie zmieniamy jej na zaliczoną na podstawie PGlite. Skaner nie zamyka pełnego MM-24: rozstrzygnięcia i dowiązania wpłat należą do PL-08.

## Dodatkowe scenariusze współbieżności

Dodano pięć testów: równoczesny retry przyjęcia dostawy (jeden ruch), konkurujące otwarcia spisu (jeden otwarty), konkurujące zatwierdzenia straty (jedno odjęcie), tworzenie/publikacja wersji grafiku (najnowsza pozostaje opublikowana), ostatni slot kolejki zajmowany przez jedną z dwóch wycen. Ukierunkowane zestawy po dodaniu: inventory-operations+schedules19/19 i remote14/14 na PGlite. Pełny zestaw614 testów opisany wyżej poprzedza dodanie tych pięciu przypadków; nie uruchamiano ponownie całości. Natywna bramka nadal otwarta.

Przygotowano `.github/workflows/native-postgres.yml`: osobny PostgreSQL16 w GitHub Actions, pełne API, kontrola niezależnych połączeń i artefakt logu. Konfiguracja nie wymaga sekretów produkcyjnych. Walidacja YAML i osłony runnera2/2 przeszły; workflow nie został wysłany ani wykonany zdalnie, więc PL-02 pozostaje otwarte.

Kontynuacja na polecenie użytkownika: PL-03/04 wdrożone lokalnie (rozliczenie jedzenia i utylizacja ze zdjęciami). Szczegóły w food-reconciliation-running.md. PL-02 pozostaje otwarte; zależność jest bramką odbioru, kontynuujemy implementację dalszych funkcji bez deklaracji gotowości telefonu.

PL-06 wdrożono lokalnie: Zamknięcie dnia z niezmiennym snapshotem, przeniesieniem spraw i odstępstwem właściciela. API15/15 z rezerwacjami, UI2/2; szczegóły day-close-running.md. Baza i telefon nadal osobnymi bramkami.

PL-14/15 wdrożono lokalnie: receptury, jednostki, snapshoty wersji/kosztu i rozchód POS/remote/nagród. Szczegóły recipes-running.md. Po PL-03/04/06 pełna regresja319API/259web/53shared; po podstawowej integracji receptur322API/261web, a późniejsze rozszerzenia kosztów mają osobne ukierunkowane wyniki. Nie utożsamiamy tych przebiegów z odbiorem natywnym ani finalnym MM-31.

Rozszerzona przeglądarka9/9: receptura w menu, rozliczenie jedzenia, prywatne zdjęcia przed/po, utylizacja i zamknięcie dnia działają przez rzeczywiste API/PGlite. Nie jest to odbiór telefonu ani natywnej bazy.

2026-10-17: PL-16/17 lokalnie zintegrowane (produkcja/półprodukty, dokładny koszt uzysku, blokady składników i wyjątki realizacji). Chromium9/9, web266/266, shared56/56, typy i build zaliczone. Pełne API jest ponawiane/weryfikowane: pierwszy obciążony przebieg ma dwa timeouty grafiku, więc nie deklarujemy go jako zaliczonego. Szczegóły production-running.md i stock-menu-running.md.

Pierwszy pełny przebieg po PL-16/17:328/330 (dwa timeouty grafiku przy5sekundach). Izolowane ponowienie grafiku wraz z produkcją8/8 zaliczone. Przegląd dodał osłonę przed częściowym cofnięciem ruchów produkcji przez ogólny endpoint magazynu; test publicznego API przechodzi. Nie zwiększano limitu ani nie wyłączano asercji.

PL-18 lokalnie zintegrowane: partie dostaw/produkcji, FEFO, jawna polityka alertów, spis i strata według partii, migracja LEGACY bez wymyślonych dat. Pełne API337/337 (także grafik), web269/269, shared56/56, typy i build oraz rozszerzony Chromium1/1 zaliczone. Szczegóły inventory-lots-running.md. Wynik dotyczy PGlite, nie zamyka PL-02 ani odbioru telefonu.

PL-19 lokalnie zintegrowane: uzasadnione propozycje uzupełnienia, edytowalne i wersjonowane szkice, zatwierdzenie jednej powiązanej dostawy, częściowe przyjęcia i CSV bez wysyłania. API21/21, pełny web272/272, shared57/57, typy/build i Chromium9/9. Szczegóły purchasing-running.md. Pełne API337/337 dotyczy poprzedniego commitu PL-18; po zakupach sprawdzono odpowiedni zestaw ukierunkowany.

PL-08 lokalnie zintegrowane: autorskie decyzje o wpłatach, powiązanie przez standardowy weryfikator, potwierdzone niezgodności oddzielone od UNVERIFIED, zobowiązania za dodatkowe transfery i nadpłaty, osobny zwrot z podpisem właściciela i weryfikacją w tle. Wspólne przydziały hash/zdarzenie blokują ponowne użycie w merchant i P2P. API20/20 po przeglądzie, osłony serwera8/8, pełny web276/276 (potem dodatkowy przypadek komponentu5/5), typy/build i Chromium1/1. Pełne API345/346 przed końcowym przeglądem ma jeden timeout sweeper5s, izolowane sweeper2/2; nie deklarujemy pełnego zielonego przebiegu. Szczegóły deposit-resolutions-running.md.

PL-20 lokalnie zintegrowane: trwałe dowody sprzedaży, raport REPEATABLE READ z oddzielnymi zakresami zdarzeń i bieżących zobowiązań, historyczne fiat/rabaty i CSV ze spójnymi powiązaniami. Podsumowanie i nowe zamknięcie dnia zachowują sprzedaż po zwrocie. API46/46 i końcowe finanse10/10, web281/281, shared57/57, typy/build, Chromium9/9. Szczegóły finance-running.md. Nie deklarujemy nowego pełnego zielonego API — końcowa regresja pozostaje w PL-25.

2026-10-19: task10 — przygotowany izolowany scenariusz pełnego dnia, realne API i kontrolowana symulacja portfela/łańcucha. Guardy11/11 i typy PASS; discovery1, E2E0 wykonanych z powodu braku natywnej bazy testowej. Status blocked. Szczegóły full-day-running.md.
