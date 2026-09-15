'use strict';

/**
 * address controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::address.address', ({ strapi }) => ({
  async create(ctx) {
    // Automatically get the authenticated user
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized('You must be logged in to create an address');
    }

    // Call the default core create action first
    const response = await super.create(ctx);

    // If the address was successfully created, manually update the relation
    // using the entityService to bypass permission stripping on the relation
    if (response && response.data && response.data.id) {
      await strapi.entityService.update('api::address.address', response.data.id, {
        data: {
          user: user.id
        }
      });
    }

    return response;
  }
}));
