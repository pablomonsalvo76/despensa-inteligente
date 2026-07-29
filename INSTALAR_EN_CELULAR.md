# Cómo instalar Despensa Inteligente en tu celular

Hay tres caminos. Están ordenados de más rápido a más "app nativa".
**Para probarla hoy, el camino 1 alcanza y sobra.**

---

## Camino 1 — Instalarla como app desde el navegador (5 minutos, sin APK)

Una PWA instalada se comporta igual que una app nativa: ícono propio en el
cajón de aplicaciones, pantalla completa sin barra del navegador, funciona sin
internet y manda notificaciones. Para probar el TP es indistinguible de un APK.

1. **Publicá la carpeta.** Entrá a [Netlify Drop](https://app.netlify.com/drop)
   y arrastrá la carpeta `despensa-inteligente` completa. No hace falta crear
   cuenta. Te devuelve una URL `https://algo-random.netlify.app`.
   > Se necesita **HTTPS** sí o sí: los navegadores bloquean la cámara y la
   > instalación de apps en sitios sin cifrar.
2. **Abrí esa URL en Chrome en el celular.**
3. Menú **⋮ → "Instalar aplicación"** (o "Agregar a pantalla de inicio").
4. Listo: aparece el ícono del frasco verde entre tus apps.

Extra: si mantenés presionado el ícono, vas a ver accesos directos a
**Agregar producto**, **Alertas** y **Recetas**.

---

## Camino 2 — Generar un APK real sin instalar nada (10 minutos)

[PWABuilder](https://www.pwabuilder.com) (de Microsoft) toma una URL y genera
un APK firmado listo para instalar.

1. Publicá la app como en el camino 1 y copiá la URL.
2. Entrá a **https://www.pwabuilder.com**, pegá la URL y tocá *Start*.
3. Elegí **Android → Generate Package**.
   - Dejá "Package ID" como `ar.edu.utn.frba.despensainteligente`.
   - Destildá *"Include source code"* si sólo querés el `.apk`.
4. Descargás un `.zip` con el APK adentro.
5. Pasalo al celular y abrilo. Android va a pedirte permitir
   **"Instalar apps desconocidas"** para el explorador de archivos: es normal
   en cualquier APK que no venga de Play Store.

> El APK que genera es una **TWA** (Trusted Web Activity): un contenedor
> nativo que corre tu PWA a pantalla completa. Es la misma técnica que usan
> muchas apps publicadas en Play Store.

---

## Camino 3 — Compilar el APK vos mismo con Capacitor

Para cuando quieras control total del proyecto Android (o publicarlo).
Requiere **Node.js** y **Android Studio** instalados.

```bash
# 1. Preparar el proyecto
cd despensa-inteligente/android-build
mkdir www
cp -r ../index.html ../css ../js ../icons ../manifest.json ../sw.js www/
#    (en Windows: copiá esas carpetas dentro de android-build/www a mano)

# 2. Instalar dependencias y crear el proyecto Android
npm install
npx cap add android
npx cap sync android

# 3a. Compilar el APK de prueba por línea de comandos
cd android && ./gradlew assembleDebug
#    El archivo queda en:
#    android/app/build/outputs/apk/debug/app-debug.apk

# 3b. …o abrirlo en Android Studio para compilar desde ahí
npx cap open android
```

Los archivos `package.json` y `capacitor.config.json` ya están configurados en
la carpeta `android-build/` con el nombre, el ID y los colores de la app.

---

## Qué funciona en cada caso

| Función | PWA instalada | APK (TWA / Capacitor) |
|---|---|---|
| Inventario, alertas, recetas, hogar, compras | Sí | Sí |
| Funciona sin internet | Sí | Sí |
| Cámara (escaneo y OCR) | Sí, con HTTPS | Sí |
| Notificaciones (1 por día) | Sí | Sí |
| Ícono propio y pantalla completa | Sí | Sí |
| Aparece en el cajón de apps | Sí | Sí |
| Se puede subir a Play Store | No | Sí |

## Nota honesta

Las notificaciones sólo se disparan **con la app abierta o en segundo plano
reciente**, porque el monitoreo corre en el dispositivo y no hay un servidor
que despierte la app. Un aviso real a las 9 de la mañana con la app cerrada
requiere push de servidor (Firebase), que está fuera del alcance de esta
entrega y queda documentado como paso siguiente.
