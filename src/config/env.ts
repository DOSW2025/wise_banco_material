import 'dotenv/config';
import * as joi from 'joi';

interface EnvVars {
  PORT: number;
  SERVICE_BUS_CONNECTION_STRING: string;
  BLOB_STORAGE_CONNECTION_STRING: string;
  BLOB_STORAGE_ACCOUNT_NAME: string;
}
const envsSchema = joi
  .object({
    PORT: joi.number().required(),
    SERVICE_BUS_CONNECTION_STRING: joi.string().required(),
    BLOB_STORAGE_CONNECTION_STRING: joi.string().required(),
    BLOB_STORAGE_ACCOUNT_NAME: joi.string().required(),
  })
  .unknown(true);
const result = envsSchema.validate(process.env);
if (result.error) {
  throw new Error(`Config validation error: ${result.error.message}`);
}
const envVars = result.value as EnvVars;

export const envs = {
  port: envVars.PORT,
  serviceBusConnectionString: envVars.SERVICE_BUS_CONNECTION_STRING,
  blobStorageConnectionString: envVars.BLOB_STORAGE_CONNECTION_STRING,
  blobStorageAccountName: envVars.BLOB_STORAGE_ACCOUNT_NAME,
};
