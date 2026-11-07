package com.gestionstock.commercant;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Réseau de la boutique (docs/plan_mobile_complet.md, lots 2 et 3, §4.1). La vue web
 * ne sait ni écouter / diffuser en UDP, ni appeler une adresse http:// du réseau
 * local (contenu mixte), ni ouvrir un port. Ce module ne fait QUE le transport :
 * toute la logique (branchement, synchro, jetons) reste en TypeScript
 * (src/services/reseau.ts côté caisse, src/services/reseauPrincipal.ts côté poste
 * principal), au même contrat que le bureau (client-electron/electron/services/).
 *
 * Poste principal : chaque requête d'une caisse est passée à la page par
 * l'évènement « requete » ; la page répond par repondre(id, statut, corps).
 */
@CapacitorPlugin(name = "ReseauBoutique")
public class ReseauBoutiquePlugin extends Plugin {

    private static final int PORT_RESEAU = 47800;

    /** Écoute pendant `dureeMs` les annonces des postes principaux (même message JSON que le bureau). */
    @PluginMethod
    public void rechercherPostes(PluginCall call) {
        int dureeMs = call.getInt("dureeMs", 3000);
        new Thread(() -> {
            Map<String, JSObject> trouves = new LinkedHashMap<>();
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            // Sans ce verrou, beaucoup de téléphones jettent les messages diffusés (économie de batterie).
            WifiManager.MulticastLock verrou = wifi != null ? wifi.createMulticastLock("gestion-stock-recherche") : null;
            DatagramSocket socket = null;
            try {
                if (verrou != null) {
                    verrou.setReferenceCounted(false);
                    verrou.acquire();
                }
                socket = new DatagramSocket(null);
                socket.setReuseAddress(true);
                socket.setBroadcast(true);
                socket.bind(new InetSocketAddress(PORT_RESEAU));
                long fin = System.currentTimeMillis() + dureeMs;
                byte[] tampon = new byte[4096];
                while (true) {
                    long reste = fin - System.currentTimeMillis();
                    if (reste <= 0) break;
                    socket.setSoTimeout((int) Math.max(1, reste));
                    DatagramPacket paquet = new DatagramPacket(tampon, tampon.length);
                    try {
                        socket.receive(paquet);
                    } catch (SocketTimeoutException e) {
                        break;
                    }
                    try {
                        JSONObject annonce = new JSONObject(new String(paquet.getData(), 0, paquet.getLength(), StandardCharsets.UTF_8));
                        if (!"gestion-stock".equals(annonce.optString("application"))
                                || !"poste-principal".equals(annonce.optString("type"))) continue;
                        String adresse = paquet.getAddress().getHostAddress() + ":" + annonce.optInt("port", PORT_RESEAU);
                        JSObject poste = new JSObject();
                        poste.put("boutiqueId", annonce.optString("boutiqueId"));
                        poste.put("boutiqueNom", annonce.optString("boutiqueNom"));
                        poste.put("nomPoste", annonce.optString("nomPoste"));
                        poste.put("adresse", adresse);
                        trouves.put(adresse, poste);
                    } catch (Exception ignore) {
                        // message d'une autre application : ignoré
                    }
                }
            } catch (Exception ignore) {
                // pas de réseau ou port occupé : liste vide, la caisse peut taper l'adresse
            } finally {
                if (socket != null) socket.close();
                if (verrou != null && verrou.isHeld()) verrou.release();
            }
            JSArray postes = new JSArray();
            for (JSObject poste : trouves.values()) postes.put(poste);
            JSObject resultat = new JSObject();
            resultat.put("postes", postes);
            call.resolve(resultat);
        }).start();
    }

    /**
     * Requête HTTP vers le poste principal (réseau local seulement : refusée
     * ailleurs). Renvoie le statut et le corps (texte), comme fetch.
     */
    @PluginMethod
    public void requete(PluginCall call) {
        String url = call.getString("url");
        String methode = call.getString("methode", "GET");
        String corps = call.getString("corps");
        int delaiMs = call.getInt("delaiMs", 8000);
        JSObject entetes = call.getObject("entetes", new JSObject());
        if (url == null || !url.startsWith("http://")) {
            call.reject("Adresse du poste principal invalide.");
            return;
        }
        new Thread(() -> {
            HttpURLConnection connexion = null;
            try {
                URL adresse = new URL(url);
                if (!estAdressePrivee(adresse.getHost())) {
                    call.reject("Seules les adresses du réseau de la boutique sont permises.");
                    return;
                }
                connexion = (HttpURLConnection) adresse.openConnection();
                connexion.setConnectTimeout(delaiMs);
                connexion.setReadTimeout(delaiMs);
                connexion.setRequestMethod(methode);
                connexion.setUseCaches(false);
                Iterator<String> cles = entetes.keys();
                while (cles.hasNext()) {
                    String cle = cles.next();
                    connexion.setRequestProperty(cle, entetes.getString(cle));
                }
                if (corps != null) {
                    byte[] octets = corps.getBytes(StandardCharsets.UTF_8);
                    connexion.setDoOutput(true);
                    connexion.setFixedLengthStreamingMode(octets.length);
                    if (connexion.getRequestProperty("Content-Type") == null) {
                        connexion.setRequestProperty("Content-Type", "application/json");
                    }
                    try (OutputStream sortie = connexion.getOutputStream()) {
                        sortie.write(octets);
                    }
                }
                int statut = connexion.getResponseCode();
                InputStream entree = statut >= 400 ? connexion.getErrorStream() : connexion.getInputStream();
                String texte = "";
                if (entree != null) {
                    ByteArrayOutputStream tampon = new ByteArrayOutputStream();
                    byte[] morceau = new byte[8192];
                    int lus;
                    while ((lus = entree.read(morceau)) != -1) tampon.write(morceau, 0, lus);
                    entree.close();
                    texte = tampon.toString("UTF-8");
                }
                JSObject resultat = new JSObject();
                resultat.put("statut", statut);
                resultat.put("corps", texte);
                call.resolve(resultat);
            } catch (Exception e) {
                // Même effet qu'un fetch qui échoue (poste principal éteint, autre réseau…).
                call.reject("Poste principal injoignable : " + e.getMessage());
            } finally {
                if (connexion != null) connexion.disconnect();
            }
        }).start();
    }

    /** Nom proposé pour cet appareil dans la liste du poste principal (équivalent du nom Windows). */
    @PluginMethod
    public void nomAppareil(PluginCall call) {
        String nom = null;
        try {
            nom = Settings.Global.getString(getContext().getContentResolver(), "device_name");
        } catch (Exception ignore) {
            // réglage absent sur certaines marques
        }
        if (nom == null || nom.trim().isEmpty()) nom = Build.MANUFACTURER + " " + Build.MODEL;
        JSObject resultat = new JSObject();
        resultat.put("nom", nom.trim());
        call.resolve(resultat);
    }

    // ===================== Poste principal (lot 3) =====================

    private static final int DELAI_REPONSE_PAGE_S = 20;
    private static final int TAILLE_MAX_CORPS = 50 * 1024 * 1024;
    private static final int INTERVALLE_ANNONCE_MS = 2000;

    /** Réponse attendue de la page pour une requête en cours. */
    private static class Attente {
        final CountDownLatch signal = new CountDownLatch(1);
        int statut = 503;
        String corps = "{\"detail\":\"Le poste principal ne répond pas.\"}";
    }

    private ServerSocket serveur;
    private ExecutorService travailleurs;
    private final Map<String, Attente> attentes = new ConcurrentHashMap<>();
    private Thread annonce;

    /** Ouvre le serveur sur ce port (erreur si occupé : la page essaie le suivant). */
    @PluginMethod
    public void demarrerServeur(PluginCall call) {
        int port = call.getInt("port", PORT_RESEAU);
        synchronized (this) {
            if (serveur != null && !serveur.isClosed()) {
                JSObject r = new JSObject();
                r.put("port", serveur.getLocalPort());
                call.resolve(r);
                return;
            }
            try {
                ServerSocket s = new ServerSocket();
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(port));
                serveur = s;
                travailleurs = Executors.newFixedThreadPool(8);
            } catch (Exception e) {
                call.reject("Port " + port + " occupé.");
                return;
            }
        }
        final ServerSocket ecoute = serveur;
        final ExecutorService pool = travailleurs;
        Thread accepteur = new Thread(() -> {
            while (!ecoute.isClosed()) {
                try {
                    Socket client = ecoute.accept();
                    pool.execute(() -> servir(client));
                } catch (Exception e) {
                    // serveur fermé : fin de la boucle
                }
            }
        }, "gestion-stock-serveur");
        accepteur.setDaemon(true);
        accepteur.start();
        JSObject r = new JSObject();
        r.put("port", ecoute.getLocalPort());
        call.resolve(r);
    }

    @PluginMethod
    public void arreterServeur(PluginCall call) {
        synchronized (this) {
            try {
                if (serveur != null) serveur.close();
            } catch (Exception ignore) {
                // déjà fermé
            }
            serveur = null;
            if (travailleurs != null) travailleurs.shutdownNow();
            travailleurs = null;
        }
        for (Attente a : attentes.values()) a.signal.countDown();
        attentes.clear();
        call.resolve();
    }

    /** Réponse de la page à une requête reçue. */
    @PluginMethod
    public void repondre(PluginCall call) {
        Attente attente = attentes.get(call.getString("id", ""));
        if (attente != null) {
            attente.statut = call.getInt("statut", 500);
            attente.corps = call.getString("corps", "{}");
            attente.signal.countDown();
        }
        call.resolve();
    }

    private static String lireLigne(InputStream entree) throws Exception {
        ByteArrayOutputStream ligne = new ByteArrayOutputStream();
        int c;
        while ((c = entree.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') ligne.write(c);
            if (ligne.size() > 16384) throw new Exception("ligne trop longue");
        }
        if (c == -1 && ligne.size() == 0) return null;
        return ligne.toString("ISO-8859-1");
    }

    private void servir(Socket client) {
        try (Socket s = client) {
            s.setSoTimeout(15000);
            String adresse = s.getInetAddress().getHostAddress();
            InputStream entree = new BufferedInputStream(s.getInputStream());
            OutputStream sortie = s.getOutputStream();
            if (!estAdressePrivee(adresse)) {
                ecrireReponse(sortie, 403, "{\"detail\":\"Réseau non autorisé.\"}");
                return;
            }
            String premiere = lireLigne(entree);
            if (premiere == null) return;
            String[] parties = premiere.split(" ");
            if (parties.length < 2) {
                ecrireReponse(sortie, 400, "{\"detail\":\"Requête invalide.\"}");
                return;
            }
            JSObject entetes = new JSObject();
            int longueur = 0;
            String ligne;
            while ((ligne = lireLigne(entree)) != null && !ligne.isEmpty()) {
                int deuxPoints = ligne.indexOf(':');
                if (deuxPoints <= 0) continue;
                String nom = ligne.substring(0, deuxPoints).trim().toLowerCase(Locale.ROOT);
                String valeur = ligne.substring(deuxPoints + 1).trim();
                entetes.put(nom, valeur);
                if (nom.equals("content-length")) longueur = Integer.parseInt(valeur);
            }
            if (longueur < 0 || longueur > TAILLE_MAX_CORPS) {
                ecrireReponse(sortie, 413, "{\"detail\":\"Envoi trop volumineux.\"}");
                return;
            }
            byte[] corps = new byte[longueur];
            int lus = 0;
            while (lus < longueur) {
                int n = entree.read(corps, lus, longueur - lus);
                if (n < 0) break;
                lus += n;
            }
            String id = UUID.randomUUID().toString();
            Attente attente = new Attente();
            attentes.put(id, attente);
            JSObject requete = new JSObject();
            requete.put("id", id);
            requete.put("methode", parties[0]);
            requete.put("chemin", parties[1]);
            requete.put("entetes", entetes);
            requete.put("corps", new String(corps, 0, lus, StandardCharsets.UTF_8));
            requete.put("adresse", adresse);
            notifyListeners("requete", requete);
            boolean repondu = attente.signal.await(DELAI_REPONSE_PAGE_S, TimeUnit.SECONDS);
            attentes.remove(id);
            ecrireReponse(sortie, repondu ? attente.statut : 503, attente.corps);
        } catch (Exception ignore) {
            // caisse partie en cours de route : rien à faire
        }
    }

    private static void ecrireReponse(OutputStream sortie, int statut, String corps) throws Exception {
        byte[] octets = corps.getBytes(StandardCharsets.UTF_8);
        String entete = "HTTP/1.1 " + statut + " " + (statut < 400 ? "OK" : "Erreur") + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + octets.length + "\r\n"
                + "Connection: close\r\n\r\n";
        sortie.write(entete.getBytes(StandardCharsets.ISO_8859_1));
        sortie.write(octets);
        sortie.flush();
    }

    /** Annonce le poste principal toutes les 2 s sur chaque réseau (Wi-Fi, point d'accès de cet appareil…). */
    @PluginMethod
    public void demarrerAnnonce(PluginCall call) {
        String message = call.getString("message");
        if (message == null) {
            call.reject("Annonce vide.");
            return;
        }
        arreterAnnonceInterne();
        final byte[] octets = message.getBytes(StandardCharsets.UTF_8);
        Thread fil = new Thread(() -> {
            try (DatagramSocket socket = new DatagramSocket()) {
                socket.setBroadcast(true);
                while (!Thread.currentThread().isInterrupted()) {
                    for (InetAddress destination : adressesDiffusion()) {
                        try {
                            socket.send(new DatagramPacket(octets, octets.length, destination, PORT_RESEAU));
                        } catch (Exception ignore) {
                            // réseau absent un instant : on réessaiera
                        }
                    }
                    Thread.sleep(INTERVALLE_ANNONCE_MS);
                }
            } catch (Exception ignore) {
                // arrêtée
            }
        }, "gestion-stock-annonce");
        fil.setDaemon(true);
        fil.start();
        annonce = fil;
        call.resolve();
    }

    @PluginMethod
    public void arreterAnnonce(PluginCall call) {
        arreterAnnonceInterne();
        call.resolve();
    }

    private void arreterAnnonceInterne() {
        if (annonce != null) annonce.interrupt();
        annonce = null;
    }

    private static List<InetAddress> adressesDiffusion() {
        List<InetAddress> adresses = new ArrayList<>();
        try {
            adresses.add(InetAddress.getByName("255.255.255.255"));
            for (NetworkInterface i : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!i.isUp() || i.isLoopback()) continue;
                for (InterfaceAddress a : i.getInterfaceAddresses()) {
                    if (a.getBroadcast() != null) adresses.add(a.getBroadcast());
                }
            }
        } catch (Exception ignore) {
            // pas de réseau
        }
        return adresses;
    }

    /** Adresses IPv4 de cet appareil sur le réseau de la boutique (à afficher aux caisses). */
    @PluginMethod
    public void adressesLocales(PluginCall call) {
        JSArray adresses = new JSArray();
        try {
            for (NetworkInterface i : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!i.isUp() || i.isLoopback()) continue;
                for (InetAddress a : Collections.list(i.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) adresses.put(a.getHostAddress());
                }
            }
        } catch (Exception ignore) {
            // pas de réseau
        }
        JSObject r = new JSObject();
        r.put("adresses", adresses);
        call.resolve(r);
    }

    /** Notification permanente + appareil gardé éveillé (ServicePostePrincipal). */
    @PluginMethod
    public void demarrerService(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && getActivity() != null) {
            ActivityCompat.requestPermissions(getActivity(), new String[] {Manifest.permission.POST_NOTIFICATIONS}, 47800);
        }
        try {
            ServicePostePrincipal.demarrer(getContext(), call.getString("titre"), call.getString("texte"));
            call.resolve();
        } catch (Exception e) {
            call.reject("Service impossible à démarrer : " + e.getMessage());
        }
    }

    @PluginMethod
    public void mettreAJourService(PluginCall call) {
        demarrerService(call);
    }

    @PluginMethod
    public void arreterService(PluginCall call) {
        ServicePostePrincipal.arreter(getContext());
        call.resolve();
    }

    /** Réseau privé (RFC 1918), lien local et boucle locale : comme le serveur du bureau. */
    static boolean estAdressePrivee(String hote) {
        if (hote == null) return false;
        if (hote.equals("localhost") || hote.startsWith("127.")) return true;
        String[] parties = hote.split("\\.");
        if (parties.length != 4) return false;
        try {
            int a = Integer.parseInt(parties[0]);
            int b = Integer.parseInt(parties[1]);
            return a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254);
        } catch (NumberFormatException e) {
            return false;
        }
    }
}
