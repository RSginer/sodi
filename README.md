## API Documentation

This project uses **Mastra** as the underlying server. When running in development, Mastra exposes Swagger-based API documentation.

### Running the dev server

From the project root:

```bash
npx mastra dev
# or, if you have it in package.json scripts:
npm run dev
```

### Opening Swagger / OpenAPI docs

Once the dev server is running, open this URL in your browser:

```text
http://localhost:4111/swagger-ui
```

If you change the Mastra server port in your `Mastra` configuration (e.g. `server: { port: 3000 }`), replace `4111` with that port:

```text
http://localhost:3000/swagger-ui
```

