import { DateTimeResolver, GraphQLJSON } from "graphql-scalars";
import { guestResolvers } from "./guestGraphql.js";

export const resolvers = {
  DateTime: DateTimeResolver,
  JSON: GraphQLJSON,
  Query: {
    _health: () => "HotCol Room GraphQL API is running",
    ...guestResolvers.Query,
  },
  Mutation: {
    _noop: () => true,
    ...guestResolvers.Mutation,
  },
};
