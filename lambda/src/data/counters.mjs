import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { env } from "../config.mjs";
import { ddb } from "./clients.mjs";

/**
 * Small counters stored in the same table, used for rate limits.
 * DynamoDB does the adding itself, in one step, so two requests arriving at the
 * same moment can never both squeeze past the limit.
 * (`count` and `ttl` are DynamoDB reserved words, hence the #names.)
 */

/** Add 1, unless the counter already reached `max`. Returns false when it is full. */
export async function addToCounter(key, max, ttl) {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.tableName,
        Key: { slug: key },
        UpdateExpression: "ADD #count :one SET #ttl = :ttl",
        ConditionExpression: "attribute_not_exists(#count) OR #count < :max",
        ExpressionAttributeNames: { "#count": "count", "#ttl": "ttl" },
        ExpressionAttributeValues: { ":one": 1, ":max": max, ":ttl": ttl },
      }),
    );
    return true;
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") return false;
    throw error;
  }
}

/** Take 1 back off a counter. Never goes below 0. */
export async function giveBackOne(key) {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.tableName,
        Key: { slug: key },
        UpdateExpression: "ADD #count :minus",
        ConditionExpression: "#count > :zero",
        ExpressionAttributeNames: { "#count": "count" },
        ExpressionAttributeValues: { ":minus": -1, ":zero": 0 },
      }),
    );
  } catch (error) {
    if (error?.name !== "ConditionalCheckFailedException") throw error;
  }
}
