import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import bg from "./locales/bg";

const savedLang = localStorage.getItem("villa_lang") ?? "en";

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      bg: { translation: bg },
    },
    lng: savedLang,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });

i18n.on("languageChanged", (lng) => {
  localStorage.setItem("villa_lang", lng);
});

export default i18n;
