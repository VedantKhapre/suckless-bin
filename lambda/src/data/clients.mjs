import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * The two AWS connections. Everything else talks to AWS through these.
 * Tests and the local mock replace `ddb.send` and `s3.send` with in-memory fakes.
 */
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const s3 = new S3Client({});
