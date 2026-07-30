import { gql } from "apollo-server-express";
import {
  guestMutationFields,
  guestQueryFields,
  guestTypeDefs,
} from "./guestGraphql.js";

export const typeDefs = gql`
  scalar DateTime
  scalar JSON

  ${guestTypeDefs}

  type Query {
    _health: String
    ${guestQueryFields}
  }

  type Mutation {
    _noop: Boolean
    ${guestMutationFields}
  }
`;
