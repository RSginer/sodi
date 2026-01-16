import type { FC } from 'hono/jsx'

const Layout: FC = (props) => {
    return (
        <html>
            <head>
                <title>{props.userName} termina el registro de VERI*FACTU</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <style>
                    {`
                        body {
                            margin: 0;
                            padding: 0;
                            width: 100%;
                            height: 100%;
                        }
                        iframe {
                            width: 100%;
                            height: 100%;
                            border: none;
                        }
                    `}
                </style>
            </head>
            <body>{props.children}</body>
        </html>
    )
}

const View: FC<{ userName: string, verifactuLink: string }> = (props: {
    userName: string,
    verifactuLink: string
}) => {
    return (
        <Layout userName={props.userName}>
            <iframe src={props.verifactuLink} width="100%" height="100%"></iframe>
        </Layout>
    )
}

export default View