# Konfetti

Wbiles niebotyczne? Niech to widac. Konfetti sypie sie nad glownym oknem gry
dokladnie w chwili, w ktorej postepy dobijaja do gory drabinki.

## Co potrafi

- **Konfetti przy niebotycznych** - dwie armatki z dolnych rogow okna plus
  deszcz z gory, wszystko przez okolo trzy sekundy, a potem znika bez sladu.
- **Tylko kiedy naprawde wbijesz** - plugin patrzy na `improve` z GMCP i
  strzela wylacznie przy wejsciu na 15. Zalogowanie sie z gotowymi
  niebotycznymi nie odpala konfetti, zerowanie licznika po wchlonieciu tez nie.
- **Komunikat w oknie** - `*** NIEBOTYCZNE! ***` obok wysypu, do wylaczenia.
- **Nie zaslania klikania** - konfetti rysuje sie na osobnym plotnie, ktore nie
  lapie myszy. Klikasz w gre tak samo jak zawsze.
- **Szanuje ustawienia systemu** - jesli w systemie masz wlaczone ograniczenie
  animacji, plugin siedzi cicho.

## Komendy

`/konfetti` i `/confetti` robia to samo.

| Komenda | Dziala |
| --- | --- |
| `/konfetti` | wysyp probny |
| `/konfetti on` / `/konfetti off` | wlacz / wylacz automatyczne konfetti |
| `/konfetti status` | pokaz aktualne ustawienia |
| `/konfetti sila <procent>` | ile konfetti, od 25 do 300 |
| `/konfetti czas <sekundy>` | jak dlugo leci, od 0.8 do 12 |
| `/konfetti komunikat on` / `off` | komunikat w oknie gry |

## Instalacja

1. W menedzerze pluginow Arkadia Web Client dodaj adres:
   `https://delwing.github.io/arkadia-konfetti/plugin.js`
2. Wpisz `/konfetti`, zeby sprawdzic, czy dziala.

## Prywatnosc

Ustawienia leza w localStorage przegladarki (`plugin:konfetti:settings`) -
**nic nie jest nigdzie wysylane**, plugin nie wykonuje zadnych zapytan
sieciowych.

Autor: Dargoth
