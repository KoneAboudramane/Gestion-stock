package com.gestionstock.commercant;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.PowerManager;
import android.provider.Settings;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Ce que la vue web d'Android ne sait pas faire seule (docs/plan_mobile_complet.md, lot 1, §4.5) :
 * - imprimer : window.print() n'y fait rien → service d'impression d'Android
 *   (imprimantes Wi-Fi / Mopria, et « Enregistrer en PDF ») ;
 * - partager un fichier : les liens de téléchargement y sont ignorés → fichier
 *   écrit dans le cache de l'appli puis feuille de partage (WhatsApp, Drive, e-mail…).
 */
@CapacitorPlugin(name = "OutilsAppli")
public class OutilsAppliPlugin extends Plugin {

    /** Vue hors écran d'une impression de page HTML : gardée le temps de l'impression. */
    private WebView vueImpression;

    /**
     * Lance l'impression ; `call` est résolu quand la fenêtre d'impression se ferme
     * (imprimé, PDF enregistré ou annulé). La page est mise en forme PENDANT que
     * la fenêtre est ouverte : l'appli garde jusque-là ce qu'elle a préparé pour
     * l'impression (ex. classe « impression-fiche » sur la page).
     */
    private void lancerImpression(WebView vue, String nom, PluginCall call) {
        PrintManager gestionnaire = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
        PrintDocumentAdapter source = vue.createPrintDocumentAdapter(nom);
        PrintDocumentAdapter adaptateur = new PrintDocumentAdapter() {
            @Override
            public void onStart() {
                source.onStart();
            }

            @Override
            public void onLayout(PrintAttributes anciens, PrintAttributes nouveaux, CancellationSignal annulation,
                                 LayoutResultCallback retour, Bundle extras) {
                source.onLayout(anciens, nouveaux, annulation, retour, extras);
            }

            @Override
            public void onWrite(PageRange[] pages, ParcelFileDescriptor destination, CancellationSignal annulation,
                                WriteResultCallback retour) {
                source.onWrite(pages, destination, annulation, retour);
            }

            @Override
            public void onFinish() {
                source.onFinish();
                vueImpression = null;
                call.resolve();
            }
        };
        gestionnaire.print(nom, adaptateur, new PrintAttributes.Builder().build());
    }

    /** Imprime l'écran affiché (avec les styles d'impression de la page). */
    @PluginMethod
    public void imprimer(PluginCall call) {
        String nom = call.getString("nom", "Document");
        getActivity().runOnUiThread(() -> {
            try {
                lancerImpression(getBridge().getWebView(), nom, call);
            } catch (Exception e) {
                call.reject("Impression impossible : " + e.getMessage());
            }
        });
    }

    /** Imprime une page HTML complète (export PDF d'un tableau). */
    @PluginMethod
    public void imprimerHtml(PluginCall call) {
        String html = call.getString("html");
        String nom = call.getString("nom", "Document");
        if (html == null) {
            call.reject("Page à imprimer manquante.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            WebView vue = new WebView(getContext());
            vueImpression = vue;
            vue.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView v, String url) {
                    try {
                        lancerImpression(v, nom, call);
                    } catch (Exception e) {
                        call.reject("Impression impossible : " + e.getMessage());
                    }
                }
            });
            vue.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }

    /**
     * Poste principal sur téléphone : l'économie de batterie de certaines marques coupe l'appli
     * malgré la notification. Dit si l'appli en est exemptée, et ouvre la liste des réglages
     * (l'utilisateur choisit « Sans restriction » pour Gestion Stock).
     */
    @PluginMethod
    public void etatBatterie(PluginCall call) {
        PowerManager alimentation = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        JSObject r = new JSObject();
        r.put("sansRestriction", alimentation != null && alimentation.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(r);
    }

    @PluginMethod
    public void ouvrirReglagesBatterie(PluginCall call) {
        try {
            Intent reglages = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            reglages.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(reglages);
        } catch (Exception e) {
            // Réglage introuvable sur cette marque : fiche de l'appli à la place.
            Intent fiche = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            fiche.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(fiche);
        }
        call.resolve();
    }

    /** Écrit le fichier (contenu en base64) puis ouvre la feuille de partage d'Android. */
    @PluginMethod
    public void partagerFichier(PluginCall call) {
        String donnees = call.getString("donnees");
        String nom = call.getString("nom", "fichier");
        String type = call.getString("type", "application/octet-stream");
        if (donnees == null) {
            call.reject("Fichier vide.");
            return;
        }
        try {
            File dossier = new File(getContext().getCacheDir(), "partages");
            if (!dossier.exists() && !dossier.mkdirs()) throw new Exception("dossier de partage impossible à créer");
            // Nom sans chemin : jamais d'écriture hors du dossier de partage.
            File fichier = new File(dossier, new File(nom).getName());
            try (FileOutputStream sortie = new FileOutputStream(fichier)) {
                sortie.write(Base64.decode(donnees, Base64.DEFAULT));
            }
            Uri adresse = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", fichier);
            Intent envoi = new Intent(Intent.ACTION_SEND);
            envoi.setType(type);
            envoi.putExtra(Intent.EXTRA_STREAM, adresse);
            envoi.putExtra(Intent.EXTRA_SUBJECT, fichier.getName());
            envoi.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent choix = Intent.createChooser(envoi, fichier.getName());
            choix.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(choix);
            call.resolve();
        } catch (Exception e) {
            call.reject("Partage impossible : " + e.getMessage());
        }
    }
}
