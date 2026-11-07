package com.gestionstock.commercant;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Poste principal sur téléphone / tablette (docs/plan_mobile_complet.md, lot 3, §4.1) :
 * service de premier plan qui empêche Android d'endormir l'appli pendant qu'elle sert
 * les caisses — notification permanente « 🟢 Serveur de la boutique actif »,
 * processeur et Wi-Fi gardés éveillés écran éteint. Le serveur lui-même est dans
 * ReseauBoutiquePlugin ; ce service ne fait que garder l'appli en vie.
 */
public class ServicePostePrincipal extends Service {

    private static final String CANAL = "poste-principal";
    private static final int NUMERO_NOTIFICATION = 47800;
    static final String EXTRA_TITRE = "titre";
    static final String EXTRA_TEXTE = "texte";

    private PowerManager.WakeLock verrouProcesseur;
    private WifiManager.WifiLock verrouWifi;

    static void demarrer(Context contexte, String titre, String texte) {
        Intent intention = new Intent(contexte, ServicePostePrincipal.class);
        intention.putExtra(EXTRA_TITRE, titre);
        intention.putExtra(EXTRA_TEXTE, texte);
        ContextCompat.startForegroundService(contexte, intention);
    }

    static void arreter(Context contexte) {
        contexte.stopService(new Intent(contexte, ServicePostePrincipal.class));
    }

    @Override
    public int onStartCommand(Intent intention, int drapeaux, int numero) {
        String titre = intention != null ? intention.getStringExtra(EXTRA_TITRE) : null;
        String texte = intention != null ? intention.getStringExtra(EXTRA_TEXTE) : null;
        Notification notification = construireNotification(
                titre != null ? titre : "🟢 Serveur de la boutique actif",
                texte != null ? texte : "Les caisses de la boutique se branchent sur cet appareil.");
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
        ServiceCompat.startForeground(this, NUMERO_NOTIFICATION, notification, type);
        garderEveille();
        // Tué par le système malgré tout : Android le relance (l'appli rouvre son serveur au démarrage).
        return START_STICKY;
    }

    private void garderEveille() {
        if (verrouProcesseur == null) {
            PowerManager alimentation = (PowerManager) getSystemService(Context.POWER_SERVICE);
            verrouProcesseur = alimentation.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gestion-stock:poste-principal");
            verrouProcesseur.setReferenceCounted(false);
            verrouProcesseur.acquire();
        }
        if (verrouWifi == null) {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                int mode = Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                verrouWifi = wifi.createWifiLock(mode, "gestion-stock:poste-principal");
                verrouWifi.setReferenceCounted(false);
                verrouWifi.acquire();
            }
        }
    }

    private Notification construireNotification(String titre, String texte) {
        NotificationManager gestionnaire = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && gestionnaire.getNotificationChannel(CANAL) == null) {
            NotificationChannel canal = new NotificationChannel(CANAL, "Serveur de la boutique", NotificationManager.IMPORTANCE_LOW);
            canal.setDescription("Affichée tant que cet appareil est le poste principal de la boutique.");
            canal.setShowBadge(false);
            gestionnaire.createNotificationChannel(canal);
        }
        Intent ouvrir = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent toucher = ouvrir == null ? null : PendingIntent.getActivity(this, 0, ouvrir,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        return new NotificationCompat.Builder(this, CANAL)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle(titre)
                .setContentText(texte)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(texte))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(toucher)
                .build();
    }

    @Override
    public void onDestroy() {
        if (verrouProcesseur != null && verrouProcesseur.isHeld()) verrouProcesseur.release();
        if (verrouWifi != null && verrouWifi.isHeld()) verrouWifi.release();
        verrouProcesseur = null;
        verrouWifi = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intention) {
        return null;
    }
}
