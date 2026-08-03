"""
Export générique d'un tableau de rapport en CSV, Excel (.xlsx) ou PDF.
Réutilisé par toutes les vues de rapports/views.py.
"""
import csv
import io

from django.http import HttpResponse
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle

FORMATS_SUPPORTES = ("csv", "xlsx", "pdf")


def exporter_tableau(format_demande, titre, colonnes, lignes):
    """
    colonnes : liste de tuples (cle, libelle)
    lignes : liste de dicts contenant au moins les clés de `colonnes`
    Retourne une HttpResponse, ou None si `format_demande` n'est pas géré
    (la vue appelante retombe alors sur une réponse JSON standard).
    """
    if format_demande == "csv":
        return _exporter_csv(titre, colonnes, lignes)
    if format_demande == "xlsx":
        return _exporter_xlsx(titre, colonnes, lignes)
    if format_demande == "pdf":
        return _exporter_pdf(titre, colonnes, lignes)
    return None


def _nom_fichier(titre, extension):
    slug = titre.lower().replace(" ", "_")
    return f"{slug}.{extension}"


def _exporter_csv(titre, colonnes, lignes):
    reponse = HttpResponse(content_type="text/csv")
    reponse["Content-Disposition"] = f'attachment; filename="{_nom_fichier(titre, "csv")}"'
    ecrivain = csv.writer(reponse)
    ecrivain.writerow([libelle for _, libelle in colonnes])
    for ligne in lignes:
        ecrivain.writerow([ligne.get(cle, "") for cle, _ in colonnes])
    return reponse


def _exporter_xlsx(titre, colonnes, lignes):
    classeur = Workbook()
    feuille = classeur.active
    feuille.title = titre[:31] or "Rapport"
    feuille.append([libelle for _, libelle in colonnes])
    for ligne in lignes:
        feuille.append([ligne.get(cle, "") for cle, _ in colonnes])

    tampon = io.BytesIO()
    classeur.save(tampon)
    tampon.seek(0)
    reponse = HttpResponse(
        tampon.read(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    reponse["Content-Disposition"] = f'attachment; filename="{_nom_fichier(titre, "xlsx")}"'
    return reponse


def _exporter_pdf(titre, colonnes, lignes):
    tampon = io.BytesIO()
    document = SimpleDocTemplate(tampon, pagesize=A4, title=titre)

    entete = [libelle for _, libelle in colonnes]
    donnees = [entete] + [[str(ligne.get(cle, "")) for cle, _ in colonnes] for ligne in lignes]
    tableau = Table(donnees, repeatRows=1)
    tableau.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F4E79")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F2F2F2")]),
    ]))
    document.build([tableau])

    tampon.seek(0)
    reponse = HttpResponse(tampon.read(), content_type="application/pdf")
    reponse["Content-Disposition"] = f'attachment; filename="{_nom_fichier(titre, "pdf")}"'
    return reponse
