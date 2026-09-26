# Compendium Library

A searchable, filterable library for Foundry VTT (dnd5e) that pulls every spell, item, feat, class option and creature from all of your compendiums into one window.

- **Everything in one place:** system packs, module packs, your own homebrew and older-edition conversions, and world items and actors.
- **Filters that fit each kind of entry:**
  - Spells: level, school, class list, casting time, damage type.
  - Items: type, rarity, attunement, price.
  - Creatures: CR, type, size, habitat.
  - Every kind: source and edition.
- **Search:** every word must match, `-word` excludes a word, and `"quoted phrase"` matches the exact phrase.
- **Favourites, recently used, your own collections and tags.** These are saved in `Data/compendium-library-data`, so they're shared by every world on the server.
- **Duplicates hidden:** the same entry sitting in several packs shows once.
- **Drag and drop:** drag any entry onto a character sheet, the canvas, the sidebar or a compendium.

## 5e.tools (optional)
If your server has a copy of 5e.tools in its Data folder and you use [Plutonium](https://github.com/TheGiddyLimit/plutonium-next), the library lists that copy too, including its homebrew and prerelease folders. Dropping one of those entries imports it through Plutonium.

1. Put the 5e.tools copy in your Data folder (the default folder name is `5etools`). If you use another name, change the **5e.tools folder** setting.
2. Open the library as a GM. It builds its list once (about 20 seconds) and shares it with your players.
3. Accept the prompt to point Plutonium at the local copy, then reload.

If there's no 5e.tools copy, the library simply shows your compendiums.

## Opening it
- Press **Shift + L**, or
- Click the **Compendium Library** button at the top of the Compendium, Items and Actors sidebar tabs.

## Header buttons (GM)
- **Re-read every compendium:** the library remembers each pack and only re-reads one when it changes. Use this if something looks out of date.
- **Rebuild the 5e.tools list:** use this after you update your 5e.tools copy or add homebrew files.

## Installing
In Foundry, go to **Add-on Modules → Install Module**, paste this manifest URL and click Install:

```
https://github.com/charliesuits/foundry-compendium-library/releases/latest/download/module.json
```
