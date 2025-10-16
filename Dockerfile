# Usa una imagen base oficial de Node.js
FROM node:20-slim

# Crea el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Copia los archivos de definición de dependencia (package.json y package-lock.json)
COPY package*.json ./

# Instala las dependencias.
RUN npm install --omit=dev

# Copia el código fuente de tu aplicación al directorio de trabajo
COPY . .

# --- CONFIGURACIÓN DE PUERTO Y EJECUCIÓN ---

# Define una variable de entorno con el puerto (la toma index.js)
ENV PORT=8081

# EXPONE el puerto que la aplicación escuchará (importante para Docker)
EXPOSE 8081

# Comando de inicio: ejecuta Node.js directamente como proceso principal (PID 1)
CMD [ "node", "index.js" ]
