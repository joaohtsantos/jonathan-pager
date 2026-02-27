export default {
  expo: {
    name: "Jonathan Pager",
    slug: "jonathan-pager",
    version: "1.0.0",
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
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
      permissions: ["RECEIVE_BOOT_COMPLETED", "VIBRATE"],
    },
    plugins: [
      [
        "expo-notifications",
        {
          icon: "./assets/icon.png",
          color: "#111111",
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
