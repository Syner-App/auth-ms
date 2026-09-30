import 'dotenv/config';

import Joi from 'joi';

interface EnvVars {
    PORT: number;
    DATABASE_URL: string;
    JWT_SECRET: string;
    JWT_EXPIRES_IN: string;
    OWNER_NAME: string;
    OWNER_EMAIL: string;
    OWNER_PASSWORD: string;
}

const envsSchema = Joi.object({
    PORT: Joi.number().required(),
    DATABASE_URL: Joi.string().required(),
    JWT_SECRET: Joi.string().required(),
    JWT_EXPIRES_IN: Joi.string().default('2h'),
    // Initial owner, created on startup when no user has OWNER_EMAIL
    OWNER_NAME: Joi.string().required(),
    OWNER_EMAIL: Joi.string().email().required(),
    OWNER_PASSWORD: Joi.string().required(),
}).unknown(true);

const { error, value } = envsSchema.validate(process.env);

if (error) {
     throw new Error(`Config validation error: ${ error }`);
}

const envVars: EnvVars = value;

export const envs = {
    port: envVars.PORT,
    databaseUrl: envVars.DATABASE_URL,
    jwtSecret: envVars.JWT_SECRET,
    jwtExpiresIn: envVars.JWT_EXPIRES_IN,
    owner: {
        name: envVars.OWNER_NAME,
        email: envVars.OWNER_EMAIL,
        password: envVars.OWNER_PASSWORD,
    },
}
