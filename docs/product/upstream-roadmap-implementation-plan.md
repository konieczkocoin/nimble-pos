# Plan uzupełnienia roadmapy kolegi

Data: 18.10.2026. Status: plan, bez implementacji nowych funkcji.
Baza naszej wersji: d6d5d56. Skill: research.

## Źródła i rozbieżności

Odczytano bezpośrednio oficjalne gallareton/nimble: README, ROADMAP,
Landing.tsx na main, listę gałęzi i otwartych issues (pusta lista).
Main: c9559445b9841fef469e42c18f1ee3a00df72453.
Gałąź pos/shift-report-export: 9c6bdcbaee94e80c71d508bc82aac8a4c5794488.
Gałąź feature/unified-network: acce09b35187c9e8a8062b0650bafa1ed8e29a82.

Źródła:
- [Roadmapa main](https://github.com/gallareton/nimble/blob/c9559445b9841fef469e42c18f1ee3a00df72453/ROADMAP.md)
- [Rozszerzona roadmapa POS](https://github.com/gallareton/nimble/blob/9c6bdcbaee94e80c71d508bc82aac8a4c5794488/ROADMAP.md)
- [Landing main](https://github.com/gallareton/nimble/blob/c9559445b9841fef469e42c18f1ee3a00df72453/apps/web/src/components/Landing.tsx)

Roadmapa POS zawiera katalog/koszyk, gotówkę lub NIM, raporty według
produktów/operatorów, API kluczy i polling. Jest bogatsza od main.
Zrzut użytkownika odpowiada temu zakresowi, ale nie ustalono commitu
wdrożonej strony. Nie utożsamiamy gałęzi z działającym wdrożeniem.
Tabela „Now” w dokumencie określa zakres planu, nie dowód wykonania.
Stara gałąź unified-network proponuje Cashlinks; main i gałąź POS już
je odrzucają. Nie przywracamy odrzuconego pomysłu na podstawie starego README.

## Porównanie z naszą wersją

| Obszar | Ocena |
|---|---|
| POS | Katalog, koszyk, pozycje, role, zmiany, raporty, rabaty i znacznie szerszy magazyn są. Brak potwierdzonej ścieżki gotówki; nie zamykamy całego punktu |
| Remote charge | Istnieje chargeRequests.ts z powiązaniem ze zmianą, referencją i ważnością24h; odróżnić od zamówienia klienta z menu |
| Zwroty i PIN | Kod istnieje; odbiór rzeczywistych przepływów nadal otwarty |
| USDT Polygon | Istnieje merchantPayments.ts z weryfikacją Polygon i tokenem USDT; nie oznacza odbioru urządzenia ani pełnego rozszerzenia wszystkich starszych przepływów P2P |
| Merchant API | Wewnętrzne API aplikacji istnieje. Nie potwierdzono publicznych kluczy integracyjnych, ich zakresów i cyklu wydania/odwołania |
| Bill splitting | Nie potwierdzono modelu wspólnego rachunku i przypisanych wpłat |
| Napiwki, profil firmy | Do uzupełnienia; wpisanie NIP nie jest weryfikacją firmy |
| Telefon/SMS | Do zaprojektowania i wdrożenia wraz z dostawcą SMS |
| Status usługi i opłaty | Dodatkowe pozycje roadmapy poza zrzutem; nie utożsamiać raportów sprzedaży z rejestrem opłat platformy |

Dowody lokalne: packages/shared/src/merchant.ts i services/merchantFx.ts
definiują aktywa NIM/USDT; routes/chargeRequests.ts obsługuje prywatne
uwierzytelnione rachunki; services/merchantPayments.ts obsługuje Polygon.
Przegląd nazw/modeli/tras nie jest pełnym audytem każdego obcego brancha.
Nie scalono zmian kolegi i nie zmieniono jego repozytorium.

## Kolejność realizacji

To rekomendowana kolejność integracji i wydawania. Istniejące R03–R09 nadal
są warunkami odbioru. Nowe funkcje nie znoszą zaległych testów ani backupu.

| Krok | Historia użytkownika i zakres | Warunek odbioru |
|---|---|---|
| U00 | Jako właściciel chcę wiarygodnej podstawy danych: domknąć R03, potem odbiór R04 i szkic R05 | Zielony natywny PostgreSQL, poprawne raporty, trwały szkic produkcji |
| U01 | Jako kasjer chcę zapisać sprzedaż gotówkową: metoda płatności odrębna od aktywa crypto, ręczne potwierdzenie odbioru, reszta, korekty | Ta sama sprzedaż aktualizuje magazyn/lojalność/raport raz, retry nie dubluje; raport oddziela gotówkę/NIM/USDT; brak fikcyjnej transakcji blockchain |
| U02 | Jako właściciel chcę jednego kompletnego POS: uzgodnić katalog, sprzedaż, rabaty, remote bills, raporty według produktu i kasjera | Macierz wymagań gałęzi POS i nasze testy; sprawdzić także pozycje jednorazowe oraz archiwizację produktów; braki poprawić przed R06–R09 |
| U03 | Jako sprzedawca chcę przyjąć USDT na telefonie: wykorzystać istniejący adapter, domknąć recovery, sieć i zwroty | W R09 rzeczywisty provider, właściwy token/sieć, restart po wysłaniu, brak podwójnej sprzedaży; osobno ustalić czy P2P też obejmuje USDT |
| U04 | Jako właściciel sklepu internetowego chcę wystawiać rachunki przez Merchant API v1 | Klucze ograniczone do lokalu i uprawnień, wydanie/odwołanie, zewnętrzna referencja, idempotencja, odczyt statusu/hash, limity i przykład integracji; klucz nie podpisuje wypłat |
| U05 | Jako integrator chcę otrzymywać trwałe webhooki płatności | Podpis, kolejka/outbox, retry, deduplikacja, zdarzenia poza kolejnością, ponowne dostarczenie i możliwość pollingu |
| U06 | Jako klient chcę zostawić dobrowolny napiwek | Osobna kwota przed podpisem, jasny odbiorca, rozdzielenie w raporcie i zasady zwrotu; bez domyślnego ukrytego dodatku |
| U07 | Jako klient chcę wiedzieć komu płacę: profil firmy | Dane deklarowane oddzielone od zweryfikowanych; oznaczenie weryfikacji dopiero po rzeczywistej procedurze, ślad zmiany adresu wypłat |
| U08 | Jako grupa klientów chcemy podzielić rachunek | Jeden rachunek nadrzędny, równe lub własne udziały, dokładne zaokrąglenia, częściowe wpłaty/wygaśnięcie/zwroty; sprzedaż i zapas zapisane raz niezależnie od liczby płatników |
| U09 | Jako użytkownik chcę zapłacić na numer telefonu | SMS-MO i dostawca, zgoda na odnajdywanie, ochrona wyszukiwania, ponowne przypisanie numeru, limity zaproszeń; brak transferu do niepowiązanego odbiorcy |
| U10 | Jako sprzedawca chcę znać stan usługi i naliczone opłaty | Status page powstaje przy przygotowaniu hostingu R09; rejestr opłat dopiero po ustaleniu modelu cenowego, jawne rozliczenie, bez automatycznego pobierania z portfela |

U03 jest odbiorem istniejącego zakresu równolegle z R09, nie przepisywaniem USDT.
U10 zawiera dwa oddzielne zadania: status operacyjny wcześnie, opłaty później.
Przed startem każdej implementacji doprecyzować jej model i testy; powyższa
lista nie jest deklaracją wykonanych integracji. Skill implement do realizacji,
tdd do pieniężnych stanów i retry, code-review do odbioru zmian.

## Różnice produktowe, których nie należy nadpisywać

Kolega proponuje osobisty telefon i tożsamość portfelową pracownika.
Użytkownik Nimble wcześniej wybrał wspólny telefon lokalu i konta/PIN
pracowników. Zachowujemy to ustalenie; wariant osobistego telefonu można
rozważyć osobno, bez cofania istniejącego rozdzielenia uprawnień i portfela.

Cashlinks pozostają wyłączone z kolejki zgodnie z nowszą roadmapą.
AI-01 pozostaje WKRÓTCE, nie jest implementowane w tej pracy.
Nie deklarujemy zgodności fiskalnej ani zastąpienia urządzenia fiskalnego.
