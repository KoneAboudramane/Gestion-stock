"""
Configuration Django du projet gestion_stock.
Pilotée par variables d'environnement (voir .env.example) : sans aucune
variable définie, le comportement est identique au dev d'origine (SQLite,
DEBUG=True, clé factice) — rien ne change tant qu'on ne déploie pas.
"""
import os
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")

# ATTENTION : à remplacer par une vraie clé secrète en production (DJANGO_SECRET_KEY).
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-a-remplacer-en-production")
DEBUG = os.environ.get("DJANGO_DEBUG", "True") == "True"
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "*").split(",")

# Origines autorisées à appeler l'API depuis un navigateur (client-web). Le client
# Electron n'est jamais concerné (ce n'est pas une requête d'origine navigateur).
# Vide par défaut : rien n'est autorisé tant que ce n'est pas explicitement configuré.
CORS_ALLOWED_ORIGINS = [o for o in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",") if o]

if not DEBUG and SECRET_KEY == "dev-a-remplacer-en-production":
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY doit être défini (variable d'environnement) dès que DJANGO_DEBUG=False."
    )

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # API
    "rest_framework",
    "corsheaders",

    # Apps du projet (core et comptes d'abord)
    "core",
    "comptes",
    "catalogue",
    "stock",
    "clients",
    "fournisseurs",
    "ventes",
    "achats",
    "tresorerie",
    "configuration",
    "synchronisation",
    "rapports",
    "comptabilite",

    # Phase 2 (squelette, adaptateurs simulés)
    "paiements",
    "notifications",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        # Surcharges de l'admin Django (templates/admin/*.html) : le loader de
        # fichiers (DIRS) est prioritaire sur app_directories, donc gagne même
        # si django.contrib.admin est listé avant nos apps dans INSTALLED_APPS.
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# --- Base de données ---
# DB_ENGINE non défini (ou "sqlite3") : comportement de dev inchangé.
# DB_ENGINE=postgresql ou mysql : lit DB_NAME/DB_USER/DB_PASSWORD/DB_HOST/DB_PORT.
DB_ENGINE = os.environ.get("DB_ENGINE", "sqlite3")
if DB_ENGINE == "sqlite3":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": f"django.db.backends.{DB_ENGINE}",
            "NAME": os.environ["DB_NAME"],
            "USER": os.environ.get("DB_USER", ""),
            "PASSWORD": os.environ.get("DB_PASSWORD", ""),
            "HOST": os.environ.get("DB_HOST", "localhost"),
            "PORT": os.environ.get("DB_PORT", ""),
        }
    }

# --- Email (réinitialisation de mot de passe du Patron) ---
# Sans configuration SMTP, les emails s'affichent dans la console du serveur
# (utile en dev/démo) au lieu d'échouer silencieusement.
EMAIL_BACKEND = os.environ.get("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "True") == "True"
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "no-reply@gestion-stock.local")

# Reçoit une notification à chaque nouvelle demande d'inscription (voir
# comptes/services.py::demander_inscription). Vide = pas de notification envoyée.
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# OBLIGATOIRE : modèle utilisateur personnalisé (app comptes)
AUTH_USER_MODEL = "comptes.Utilisateur"

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "Africa/Abidjan"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# Portail web du Patron (client-web) construit en fichiers statiques
# ("npm run build" dans client-web/), servi directement par WhiteNoise à la
# racine du site — pas de port séparé à ouvrir en dehors du développement.
# Si le dossier n'existe pas encore (build jamais lancé), WhiteNoise l'ignore
# simplement et la racine renvoie un 404 classique.
WHITENOISE_ROOT = BASE_DIR / "client-web" / "dist"
WHITENOISE_INDEX_FILE = True

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- API (REST Framework + JWT) ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
}

# Durées de vie généreuses : le client Electron fonctionne hors-ligne longtemps
# et ne doit pas redemander une connexion à chaque fois qu'une synchro démarre.
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=12),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
}

# --- Durcissement production (uniquement si DEBUG=False) ---
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 7  # 1 semaine pour commencer, à augmenter progressivement.
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    # nginx/Passenger terminent le HTTPS et transmettent ce header : sans lui,
    # Django ne peut pas savoir que la requête d'origine était bien en HTTPS.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    # Piloté séparément (pas déduit de DEBUG) : évite une boucle de redirection
    # si l'hébergeur gère déjà la redirection HTTP->HTTPS à son niveau. À activer
    # une fois le HTTPS confirmé fonctionnel devant l'appli.
    SECURE_SSL_REDIRECT = os.environ.get("DJANGO_SSL_REDIRECT", "False") == "True"
