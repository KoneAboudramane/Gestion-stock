"""
Point d'entrée attendu par cPanel "Setup Python App" (Phusion Passenger) sur
les hébergements mutualisés — nom et emplacement imposés par Passenger, ne
pas renommer ni déplacer. Réutilise simplement config/wsgi.py.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from config.wsgi import application  # noqa: E402,F401
