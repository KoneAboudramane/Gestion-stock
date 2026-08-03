# Déploiement du serveur gestion_stock

Le code Django est identique quel que soit l'hébergeur — seule la configuration
change. Choisis le parcours qui correspond à ton hébergement.

Variables d'environnement : voir `.env.example` à la racine du projet. Copier
en `.env` et remplir avant de démarrer, dans les deux parcours.

## Parcours A — VPS (accès root complet, recommandé)

Exemples d'hébergeurs : DigitalOcean, Hetzner, OVH VPS, Scaleway, Contabo.
Contrôle total, PostgreSQL natif, `gunicorn` + `nginx`, HTTPS via Let's Encrypt.

1. Sur le serveur : installer Python 3.11+, PostgreSQL, nginx.
2. Créer la base : `sudo -u postgres createdb gestion_stock` puis un utilisateur
   dédié (`createuser`), mot de passe à reporter dans `.env` (`DB_*`).
3. Copier le projet sur le serveur (ex. `/var/www/gestion_stock`), créer un
   venv (`python -m venv .venv`), `pip install -r requirements.txt`.
4. Copier `.env.example` en `.env`, remplir `DJANGO_SECRET_KEY` (généré),
   `DJANGO_DEBUG=False`, `DJANGO_ALLOWED_HOSTS`, `DB_ENGINE=postgresql` + les
   `DB_*`.
5. `python manage.py migrate`, `python manage.py collectstatic --noinput`,
   `python manage.py createsuperuser`.
6. Copier `deploy/gestion_stock.service.example` vers
   `/etc/systemd/system/gestion_stock.service`, adapter les chemins/utilisateur,
   puis `sudo systemctl daemon-reload && sudo systemctl enable --now gestion_stock`.
7. Copier `deploy/nginx.conf.example` vers `/etc/nginx/sites-available/gestion_stock`,
   adapter `server_name`, activer (lien vers `sites-enabled`),
   `sudo nginx -t && sudo systemctl reload nginx`.
8. HTTPS : `sudo certbot --nginx -d exemple.com` (installe/renouvelle le certificat
   et réécrit la config nginx). Une fois confirmé, passer `DJANGO_SSL_REDIRECT=True`
   dans `.env` et redémarrer le service (`sudo systemctl restart gestion_stock`).

## Parcours B — Hébergement mutualisé avec support Python (cPanel/Passenger)

Exemples : o2switch, PlanetHoster — nécessite un hébergeur qui propose
explicitement "Setup Python App" dans cPanel. Pas d'accès root, pas de
`gunicorn` (Passenger gère ça lui-même), souvent MySQL au lieu de PostgreSQL.

1. Dans cPanel : "Setup Python App" → créer une application, pointer sur le
   dossier du projet, choisir la version Python (3.11+).
2. Uploader le projet dans ce dossier (FTP/Git selon ce que propose l'hébergeur).
   `passenger_wsgi.py` (racine du projet) est déjà prêt — Passenger le détecte
   automatiquement, ne pas le renommer.
3. Copier `.env.example` en `.env` dans le même dossier, remplir les variables.
   o2switch n'offre que MySQL : garder `DB_ENGINE=mysql` (déjà la valeur par
   défaut de `.env.example`) et renseigner `DB_NAME`/`DB_USER`/`DB_PASSWORD`
   créés dans cPanel → "Bases de données MySQL" (généralement préfixés par ton
   identifiant cPanel, ex. `cpaneluser_gestion_stock`) ; `DB_HOST=localhost`,
   `DB_PORT=3306`.
4. Dans le terminal fourni par cPanel pour cette app Python (active
   automatiquement le bon venv) : `pip install -r requirements.txt`
   (`mysqlclient` y est déjà listé, pas d'étape séparée).
5. Toujours dans ce terminal : `python manage.py migrate`,
   `python manage.py collectstatic --noinput`, `python manage.py createsuperuser`.
6. Redémarrer l'app Python depuis l'interface cPanel ("Restart").
7. HTTPS : généralement déjà géré par l'hébergeur (AutoSSL cPanel) — vérifier
   dans "SSL/TLS Status" que le domaine est couvert, sinon l'activer depuis cPanel.

## Après déploiement (les deux parcours)

- Mettre à jour `electron/config.ts` côté client (`URL_BASE_API`) pour pointer
  vers la vraie URL du serveur au lieu de `http://localhost:8000/api`, puis
  rebuild + repackage le client Electron (`npm run package:win`) avant de le
  redistribuer.
- `python manage.py check --deploy` permet de repasser en revue les
  recommandations de sécurité Django restantes propres à l'environnement choisi.
