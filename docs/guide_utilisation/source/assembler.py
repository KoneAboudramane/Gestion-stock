import re
from pathlib import Path

ici = Path(__file__).parent
tete = (ici / "tete.html").read_text(encoding="utf-8")
corps = (ici / "corps.html").read_text(encoding="utf-8")

NBSP = " "


def typographie(texte: str) -> str:
    # Espace insécable avant ? : ; ! » et après « (typographie française).
    texte = re.sub(r" ([?:;!»])", lambda m: NBSP + m.group(1), texte)
    texte = texte.replace("« ", "«" + NBSP)
    return texte


morceaux = re.split(r"(<[^>]+>)", corps)
corps_final = "".join(m if m.startswith("<") else typographie(m) for m in morceaux)

# Contrôle : aucun signe perdu, aucun caractère de contrôle introduit.
for signe in "?:;!«»":
    assert corps.count(signe) == corps_final.count(signe), signe
assert not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", corps_final)

(ici / "guide.html").write_text(tete + "\n" + corps_final, encoding="utf-8")
print("ok", corps_final.count(NBSP), "espaces insécables")
