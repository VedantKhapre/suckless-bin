import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { env } from "../config.mjs";
import { ddb } from "./clients.mjs";

/** Save a new paste. Returns false if that link is already taken. */
export async function savePaste(item) {
  try {
    await ddb.send(
      new PutCommand({
        TableName: env.tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(slug)", // never overwrite
      }),
    );
    return true;
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") return false;
    throw error;
  }
}

/**
 * Load a paste that has not expired, or null.
 * ConsistentRead means "read the very latest data", so a paste is findable
 * the instant after it was created (the upload step needs that).
 */
export async function getLivePaste(slug) {
  const { Item } = await ddb.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { slug },
      ConsistentRead: true,
    }),
  );
  if (!Item || Item.expiresAt <= Date.now()) return null;
  return Item;
}
