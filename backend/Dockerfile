version: '3.8'

services:
  postgres:
    image: postgres:16
    container_name: manpower-postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: clown
      POSTGRES_DB: manpower_dev
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data: