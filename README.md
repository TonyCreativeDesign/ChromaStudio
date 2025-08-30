# Chroma Studio — README
PaletteCREATOR

Éditeur de palettes : génération à partir d'image ou couleurs pour créer harmonies, aléatoire, édition fine (HEX/RGB/HSL/rampe), analyse de contraste (WCAG 2.2), export multi-formats, import tolérant, accessibilité, historique, thèmes clair/sombre.

🗂 Structure
/
├─ index.html   # UI + panneaux + modale d’aide
├─ style.css    # Design system + layout + composants
└─ app.js       # State, rendu, worker quantization, I/O, actions


Aucune dépendance externe, aucun build.

🚀 Démarrage rapide

Télécharge les 3 fichiers dans le même dossier.

Ouvre index.html dans un navigateur moderne (Chrome/Edge/Firefox/Safari).

Option dev : “Live Server” de VS Code pour l’auto-reload.

(Facultatif) Passe en thème clair/sombre via l’icône en haut à gauche.

🧭 Flux de travail

Générer une palette :

Depuis une image (drag&drop, collage ou sélection) → Extraire la palette.

Par harmonie (seed + type).

Aléatoire (seed optionnelle pour reproductibilité).

Éditer une couleur : clique une tuile → règle HEX/RGB/HSL → ou crée une rampe tonale.

Analyser : onglet Analyse → grille de contraste WCAG + simulation de daltonisme.

Exporter / Importer : onglet Export (JSON/CSS/SVG/PNG/TXT).

🎨 Génération de palettes

Image : quantification en Web Worker (K-Means++ stable, Median Cut = fallback rapide).
La prévisualisation utilise un canvas redimensionné proprement (anti-aliasing).

Harmonies : Analogique, Monochromatique, Complémentaire, Complémentaire divisée, Triadique, Tétradique.
La couleur seed accepte #hex, rgb(...) ou mots-clés CSS (ex. blue, tomato).

Aléatoire : PRNG déterministe via seed (texte libre).

Verrouillage : une couleur verrouillée n’est pas écrasée lors des nouvelles générations.

✏️ Édition

Panneau Éditeur : HEX / RGB / HSL synchronisés (validation robuste).

Rampe tonale : génère rapidement des pas de luminance réguliers (H & S conservés).

Réordonner : drag & drop des tuiles ; Dupliquer / Supprimer via actions.

Nom “proche” : heuristique légère (utile pour etiquettes rapides).

Historique : Annuler / Rétablir (pile locale, 30 étapes par défaut).

🧪 Analyse (WCAG 2.2)

Contraste : ratio et badge (AAA / AA / AA Large / Fail).

Simulation : Protanopie, Deutéranopie, Tritanopie (matrices standards).

⬇️ Export / ⬆️ Import
Export

JSON (palette.json) : structure complète { name, colors:[{id,rgb,locked}, ...] }.

CSS (palette.css) : variables --color-1....

SVG (palette.svg) : barres colorées.

PNG (palette.png) : rendu rasterisé de la même grille.

TXT (palette.txt) : listing lisible.

Astuce : Alt+clic sur JSON/CSS/SVG/TXT → copie directe dans le presse-papiers.

Import (tolérant)

Accepte :

// A) Objet complet
{ "name": "Nom", "colors": [ { "rgb": [52,152,219], "locked": false }, ... ] }

// B) Tableau d'HEX
["#3498DB", "#2ECC71", "#E74C3C"]


Les id sont régénérés automatiquement.

En cas d’erreur : message toast + annonce A11y.

⌨️ Raccourcis

Générer aléatoire : Espace

Annuler : Ctrl/Cmd + Z

Rétablir : Ctrl/Cmd + Y

Verrouiller la tuile survolée : L

Copier le HEX de la tuile survolée : C

Ouvrir/Fermer l’aide : ?

Fermer modale : Échap

♿ Accessibilité

aria-live pour annonces (opérations, copie, erreurs).

Focus visible cohérent, actions au clavier (zone d’image, onglets, boutons).

Contrastes UI conformes aux thèmes, simulation daltonisme dans l’onglet Analyse.

⚙️ Performances & stockage

Quantification Web Worker (K-Means++), UI non bloquante.

Canvas d’aperçu redimensionné (qualité + rapidité).

localStorage : thème & projet courant (palette + image URL blob tant que la page est ouverte).

🧰 Dépannage

L’image n’apparaît pas
→ Essaie un autre format (png/jpg/webp). Vérifie les permissions si fichier distant (CORS).

Import JSON échoue
→ Vérifie la structure (exemples ci-dessus). Les valeurs rgb doivent être trois entiers 0-255.

Export “copie” ne marche pas
→ Certains navigateurs bloquent l’accès au presse-papiers sans interaction ; réessaie après une action (clic) dans la page.

🔒 Confidentialité

Tout s’exécute localement dans ton navigateur. Aucune donnée n’est envoyée sur un serveur.
