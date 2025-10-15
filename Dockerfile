# Usa una imagen base oficial de Node.js
FROM node:20-slim

# Crea el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Copia los archivos de definición de dependencia (package.json y package-lock.json)
# Esto permite que Docker use caché para la instalación de dependencias si no cambian
COPY package*.json ./

# Instala las dependencias. Esto reemplaza npm install en el buildpack
RUN npm install --omit=dev

# Copia el código fuente de tu aplicación al directorio de trabajo
COPY . .

# Expone el puerto que tu aplicación usa (PORT en index.js)
# Usaremos el puerto 8080 como fallback, aunque la aplicación usará process.env.PORT
EXPOSE 8080

# Comando de inicio: ejecuta el script 'start' de package.json
CMD [ "npm", "start" ]
