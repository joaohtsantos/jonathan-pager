export default {
  expo: {
    name: "Jonathan Pager",
    slug: "jonathan-pager",
    version: "1.1.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#111111",
    },
    android: {
      package: "cc.jsplayground.pager",
      googleServicesFile:
        process.env.GOOGLE_SERVICES_JSON || "./google-services.json",
      adaptiveIcon: {
        backgroundColor: "#0A0A0A",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
      permissions: [
        "RECEIVE_BOOT_COMPLETED",
        "VIBRATE",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
      ],
    },
    plugins: [
      "expo-background-task",
      [
        "expo-notifications",
        {
          icon: "./assets/icon.png",
          color: "#111111",
        },
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "Pager precisa da sua localização em background pra detectar quando você entra/sai de zonas (Casa, Segura, etc).",
          locationAlwaysPermission:
            "Pager precisa da sua localização em background pra detectar quando você entra/sai de zonas.",
          locationWhenInUsePermission:
            "Pager mostra sua localização atual e te deixa cadastrar zonas usando a posição atual.",
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
    ],
    extra: {
      eas: {
        projectId: "00f38f4e-21a0-43da-b440-20c6a09679a4",
      },
    },
    owner: "joaohts",
  },
};
