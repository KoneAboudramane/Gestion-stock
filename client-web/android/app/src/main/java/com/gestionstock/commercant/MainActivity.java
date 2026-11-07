package com.gestionstock.commercant;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Modules propres à l'appli (impression et partage ; réseau de la boutique ; sauvegarde) : à déclarer avant super.onCreate.
        registerPlugin(OutilsAppliPlugin.class);
        registerPlugin(ReseauBoutiquePlugin.class);
        registerPlugin(SauvegardePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
