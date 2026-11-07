package com.gestionstock.commercant;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Sauvegarde sur téléphone / tablette (docs/plan_mobile_complet.md, lot 4, §4.6) :
 * le chiffrement et la logique restent en TypeScript (src/services/sauvegarde.ts,
 * même fichier .gsbak que le bureau) ; ce module donne seulement :
 * - le dossier des copies, choisi une fois avec le sélecteur d'Android (Google
 *   Drive, carte mémoire, Téléchargements…) — autorisation gardée ;
 * - lire / écrire / lister / supprimer les copies dans ce dossier ;
 * - le coffre d'Android (Keystore) pour garder la clé des sauvegardes
 *   automatiques — l'équivalent de la protection Windows (DPAPI) du bureau.
 */
@CapacitorPlugin(name = "Sauvegarde")
public class SauvegardePlugin extends Plugin {

    private static final String ALIAS_CLE = "gestion-stock-sauvegarde";

    // --- Choisir le dossier / une copie ---

    @PluginMethod
    public void choisirDossier(PluginCall call) {
        Intent intention = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intention.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intention, "dossierChoisi");
    }

    @ActivityCallback
    private void dossierChoisi(PluginCall call, ActivityResult resultat) {
        JSObject r = new JSObject();
        if (resultat.getResultCode() != Activity.RESULT_OK || resultat.getData() == null || resultat.getData().getData() == null) {
            call.resolve(r);
            return;
        }
        Uri arbre = resultat.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(arbre,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignore) {
            // certains fournisseurs ne gardent pas l'autorisation : on réessaiera au prochain choix
        }
        r.put("uri", arbre.toString());
        r.put("nom", nomDuDossier(arbre));
        call.resolve(r);
    }

    @PluginMethod
    public void choisirFichier(PluginCall call) {
        Intent intention = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intention.addCategory(Intent.CATEGORY_OPENABLE);
        intention.setType("*/*");
        startActivityForResult(call, intention, "fichierChoisi");
    }

    @ActivityCallback
    private void fichierChoisi(PluginCall call, ActivityResult resultat) {
        JSObject r = new JSObject();
        if (resultat.getResultCode() != Activity.RESULT_OK || resultat.getData() == null || resultat.getData().getData() == null) {
            call.resolve(r);
            return;
        }
        Uri fichier = resultat.getData().getData();
        r.put("uri", fichier.toString());
        r.put("nom", nomDuFichier(fichier));
        call.resolve(r);
    }

    private String nomDuDossier(Uri arbre) {
        try {
            Uri dossier = DocumentsContract.buildDocumentUriUsingTree(arbre, DocumentsContract.getTreeDocumentId(arbre));
            String nom = nomDuFichier(dossier);
            if (nom != null) return nom;
        } catch (Exception ignore) {
            // nom illisible
        }
        return "Dossier choisi";
    }

    private String nomDuFichier(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignore) {
            // nom illisible
        }
        return null;
    }

    // --- Copies dans le dossier ---

    /** Copies du dossier (nom, adresse, taille, date). `accessible` faux si l'autorisation est perdue ou le dossier supprimé. */
    @PluginMethod
    public void listerDossier(PluginCall call) {
        JSObject r = new JSObject();
        JSArray fichiers = new JSArray();
        try {
            Uri arbre = Uri.parse(call.getString("dossier", ""));
            Uri enfants = DocumentsContract.buildChildDocumentsUriUsingTree(arbre, DocumentsContract.getTreeDocumentId(arbre));
            String[] colonnes = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
            };
            try (Cursor c = getContext().getContentResolver().query(enfants, colonnes, null, null, null)) {
                if (c == null) throw new Exception("dossier illisible");
                while (c.moveToNext()) {
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(4))) continue;
                    JSObject f = new JSObject();
                    f.put("nom", c.getString(1));
                    f.put("uri", DocumentsContract.buildDocumentUriUsingTree(arbre, c.getString(0)).toString());
                    f.put("taille", c.isNull(2) ? 0 : c.getLong(2));
                    f.put("date", c.isNull(3) ? 0 : c.getLong(3));
                    fichiers.put(f);
                }
            }
            r.put("accessible", true);
        } catch (Exception e) {
            r.put("accessible", false);
        }
        r.put("fichiers", fichiers);
        call.resolve(r);
    }

    /** Écrit une copie : d'abord sous un nom provisoire, puis renommée — jamais de copie à moitié écrite. */
    @PluginMethod
    public void ecrireFichier(PluginCall call) {
        String nom = call.getString("nom");
        String donnees = call.getString("donnees");
        if (nom == null || donnees == null) {
            call.reject("Copie vide.");
            return;
        }
        new Thread(() -> {
            ContentResolver contenus = getContext().getContentResolver();
            try {
                Uri arbre = Uri.parse(call.getString("dossier", ""));
                Uri dossier = DocumentsContract.buildDocumentUriUsingTree(arbre, DocumentsContract.getTreeDocumentId(arbre));
                Uri provisoire = DocumentsContract.createDocument(contenus, dossier, "application/octet-stream", nom + ".tmp");
                if (provisoire == null) throw new Exception("impossible de créer le fichier");
                try (OutputStream sortie = contenus.openOutputStream(provisoire, "w")) {
                    if (sortie == null) throw new Exception("fichier illisible");
                    sortie.write(Base64.decode(donnees, Base64.DEFAULT));
                }
                Uri finale = null;
                try {
                    finale = DocumentsContract.renameDocument(contenus, provisoire, nom);
                } catch (Exception ignore) {
                    // fournisseur sans renommage : repli ci-dessous
                }
                if (finale == null) {
                    // Repli : réécrit sous le bon nom, puis supprime le provisoire.
                    finale = DocumentsContract.createDocument(contenus, dossier, "application/octet-stream", nom);
                    try (OutputStream sortie = contenus.openOutputStream(finale, "w")) {
                        sortie.write(Base64.decode(donnees, Base64.DEFAULT));
                    }
                    DocumentsContract.deleteDocument(contenus, provisoire);
                }
                JSObject r = new JSObject();
                r.put("uri", finale.toString());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Dossier de sauvegarde inaccessible (Google Drive déconnecté ? carte mémoire retirée ?) : " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void lireFichier(PluginCall call) {
        new Thread(() -> {
            try (InputStream entree = getContext().getContentResolver().openInputStream(Uri.parse(call.getString("uri", "")))) {
                if (entree == null) throw new Exception("fichier illisible");
                ByteArrayOutputStream tampon = new ByteArrayOutputStream();
                byte[] morceau = new byte[65536];
                int lus;
                while ((lus = entree.read(morceau)) != -1) tampon.write(morceau, 0, lus);
                JSObject r = new JSObject();
                r.put("donnees", Base64.encodeToString(tampon.toByteArray(), Base64.NO_WRAP));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Copie illisible : " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void supprimerFichier(PluginCall call) {
        try {
            DocumentsContract.deleteDocument(getContext().getContentResolver(), Uri.parse(call.getString("uri", "")));
            call.resolve();
        } catch (Exception e) {
            call.reject("Suppression impossible : " + e.getMessage());
        }
    }

    // --- Coffre d'Android : clé des sauvegardes automatiques ---

    private SecretKey cleDuCoffre() throws Exception {
        KeyStore coffre = KeyStore.getInstance("AndroidKeyStore");
        coffre.load(null);
        if (coffre.containsAlias(ALIAS_CLE)) return ((KeyStore.SecretKeyEntry) coffre.getEntry(ALIAS_CLE, null)).getSecretKey();
        KeyGenerator generateur = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generateur.init(new KeyGenParameterSpec.Builder(ALIAS_CLE, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generateur.generateKey();
    }

    /** Protège la clé (base64) par le coffre : renvoie IV + chiffré (base64). */
    @PluginMethod
    public void protegerCle(PluginCall call) {
        try {
            Cipher chiffreur = Cipher.getInstance("AES/GCM/NoPadding");
            chiffreur.init(Cipher.ENCRYPT_MODE, cleDuCoffre());
            byte[] chiffre = chiffreur.doFinal(Base64.decode(call.getString("cle", ""), Base64.DEFAULT));
            byte[] iv = chiffreur.getIV();
            ByteBuffer tout = ByteBuffer.allocate(1 + iv.length + chiffre.length);
            tout.put((byte) iv.length).put(iv).put(chiffre);
            JSObject r = new JSObject();
            r.put("protegee", Base64.encodeToString(tout.array(), Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Coffre indisponible : " + e.getMessage());
        }
    }

    @PluginMethod
    public void libererCle(PluginCall call) {
        try {
            byte[] tout = Base64.decode(call.getString("protegee", ""), Base64.DEFAULT);
            int longueurIv = tout[0];
            Cipher dechiffreur = Cipher.getInstance("AES/GCM/NoPadding");
            dechiffreur.init(Cipher.DECRYPT_MODE, cleDuCoffre(), new GCMParameterSpec(128, tout, 1, longueurIv));
            byte[] cle = dechiffreur.doFinal(tout, 1 + longueurIv, tout.length - 1 - longueurIv);
            JSObject r = new JSObject();
            r.put("cle", Base64.encodeToString(cle, Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Clé de sauvegarde illisible sur cet appareil : " + e.getMessage());
        }
    }
}
