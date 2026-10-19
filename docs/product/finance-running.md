# PL-20 — rozliczenie finansowe i CSV

Panel właściciela „Financial reconciliation” pobiera jeden spójny, tylko do odczytu snapshot REPEATABLE READ. Okres ma początek włącznie i koniec wyłącznie, interfejs opisuje datowniki jako UTC. Sprzedaż oraz zgłoszenia i potwierdzenia transferów należą do wybranego okresu. Otwarte zobowiązania i zamówienia oczekujące na akceptację są bieżące niezależnie od okresu; nie są rekonstrukcją zobowiązań na historyczny koniec okresu. Nieprzypisane wpływy pokazują aktualne przypisanie wpływów z wybranego okresu. Transfery bez daty pozostają osobnymi rekordami wymagającymi sprawdzenia.

## Sprzedaż historyczna

Migracja0040 dodaje niezmienny zapis sprzedaży w tej samej transakcji co jej przyjęcie i rozchód. POS zapisuje czas przyjęcia na serwerze, remote czas akceptacji lokalu. Przechowujemy zamrożoną walutę, cenę pierwotną, rabat, cenę po rabacie, rewizję koszyka i powiązanie z wpłatą. Nie pobieramy bieżącego kursu. Późniejsza decyzja o zwrocie nie usuwa sprzedaży.

Podsumowanie właściciela i nowy snapshot zamknięcia dnia korzystają z tego dowodu sprzedaży zamiast bieżącego statusu zamówienia. Zamknięcie dnia nadal obejmuje operacyjną grupę zamówień utworzonych w danym dniu, a raport finansowy zdarzenia przyjęcia sprzedaży w wybranym okresie. Poprzednio zapisane, niezmienne zamknięcia nie są przepisywane.

Dashboard lokalu również sumuje zapisane przyjęcia sprzedaży w swoim ruchomym
oknie 24 godzin. Późniejsza odmowa realizacji i potwierdzony zwrot nie usuwają
przyjętej sprzedaży z tego licznika. To sprzedaż brutto po rabacie, nie wynik netto
po zwrotach; przepływy i zwroty pozostają oddzielnymi metrykami. Zamówienie
odrzucone przed akceptacją nie tworzy sprzedaży. Wartość UNRESOLVED nie jest
włączana do sumy potwierdzonej sprzedaży.

Migracja opiera historyczne przyjęcie na utrwalonej decyzji remote, stanie przyjętej płatności POS albo dowodzie rozchodu. Gdy dokładny czas przyjęcia POS nie jest znany, używa jawnie oznaczonego czasu potwierdzenia historycznej wpłaty. Niejednoznaczne przypadki mają UNRESOLVED i brak daty przyjęcia; nie stają się fikcyjną sprzedażą ani ceną0. Czas zgłoszenia starego zwrotu odtwarzamy tylko z rzeczywistego audytu, nigdy z czasu migracji lub retry.

## Przepływy i zobowiązania

Potwierdzony receipt zamówienia oraz odpowiadająca mu obserwacja skanera nie są liczone podwójnie. Tożsamość obejmuje sieć/hash, a przy osobnych zdarzeniach tokenu także indeks zdarzenia. Nie dopasowujemy po samej kwocie. Sprzeczne fakty wymagają przeglądu zamiast ukrytego scalenia.

Nadpłaty i dodatkowe wpłaty są wpływami i osobnymi zobowiązaniami, nie drugą sprzedażą. Potwierdzony zwrot sprzedaży odwraca jej historyczną wartość fiat raz; zwrot nadpłaty albo wpłaty bez sprzedaży nie tworzy fikcyjnego ujemnego przychodu fiat. Hash zgłoszonego zwrotu nie pomniejsza jeszcze potwierdzonego przepływu. „Wysłane” i „potwierdzone” pokazują dwa etapy tego samego transferu, nie dwa wydatki. Zobowiązanie pozostaje do czasu potwierdzenia.

Kwoty atomowe i sumy minor są liczone przez BigInt i zwracane jako tekst. „Wpływy minus potwierdzone zwroty” nie jest saldem portfela: nie obejmuje gazu, innych wypłat ani salda otwarcia. Zasięg skanera i jego błędy są widoczne; zgodność znanych rekordów nie oznacza odczytania całego portfela.

## CSV i dostęp

CSV pochodzi z dokładnie wyświetlonego snapshotu, zawiera cały jego dziennik, zakres, czas odczytu, typ i zakres każdego rekordu, identyfikatory zamówienia, źródła i zobowiązania oraz hash. Identyfikator zobowiązania wiąże właściwy dodatkowy wpływ z jego zwrotem także przy kilku równych wpłatach za jedno zamówienie. Filtr ekranu nie zmienia eksportu. Nie eksportujemy zdjęć, tokenów checkout ani adresów klientów. Cytowanie i neutralizacja prefiksów formuł korzystają ze wspólnego mechanizmu CSV.

Raport jest dostępny tylko właścicielowi danego lokalu. Zakres do366dni; do5000 rekordów na zbiór źródłowy. Przekroczenie zwraca jawny błąd zamiast częściowych sum. Wiersze ekranu są stronicowane po50, eksport obejmuje pełny odebrany snapshot.

## Zbiór kontrolny

| Zdarzenie | Wartość |
|---|---:|
| Pierwotna cena sprzedaży | 1000 minor EUR |
| Rabat | 100 minor EUR |
| Przyjęta sprzedaż | 900 minor EUR |
| Pierwotna wpłata | 900000 NIM atomic |
| Dodatkowa wpłata | 450000 NIM atomic |
| Nieprzypisany potwierdzony wpływ | 12345 NIM atomic |
| Potwierdzony zwrot sprzedaży | 900000 NIM atomic |
| Zgłoszony, niepotwierdzony zwrot dodatkowej wpłaty | 450000 NIM atomic |
| Opłacony remote przed akceptacją | 2000000 USDT atomic |

Oczekiwane NIM: wpływy1362345, zgłoszone zwroty1350000 (w tym już potwierdzone900000), potwierdzone zwroty900000, różnica462345, bieżące zobowiązanie450000. Fiat: sprzedaż900, potwierdzony zwrot sprzedaży900, różnica0 EUR minor. Remote nie jest jeszcze sprzedażą; osobno czeka2000000 USDT atomic. Sumy CSV odpowiadają tym kategoriom dziennika.

## Weryfikacja

API integracyjne46/46: finanse, remote, rabaty, rezerwacje i rozstrzygnięcia wpłat. Następnie doprecyzowanie okresu i brakujących dat: finanse10/10, w tym ręczny zbiór, sumy CSV, migracja dowodów i równoczesne przyjęcie płatności. Wcześniej integracja podsumowania i zamknięcia dnia17/17. UI17/17 (finanse, format, merchant i zamknięcie dnia). Typy API/web przechodzą; Drizzle nie wykrywa rozbieżności schematu.

Chromium9/9: rzeczywiste API/PGlite, odczyt raportu i pobranie CSV; fixture FINALIZED jest liczony, fixture OBSERVED pozostaje wykluczony. Kontrola320/390/736/1280px bez przepełnienia. Portfele i łańcuchy nadal testowe. Pełny web281/281, shared57/57 i końcowy build zaliczone. Nie ponawiano całego API po PL-20; poprzedni pełny przebieg345/346 ma timeout sweeper, więc nie deklarujemy zielonej całości. Natywna baza i rzeczywiste integracje nadal są osobnymi bramkami.
