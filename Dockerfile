
FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npx tsc -b


CMD ["node", "dist/ClipBot.js"]
