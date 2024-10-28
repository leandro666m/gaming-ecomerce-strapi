'use strict';

require('stripe')('sk_test_51Q5Z1PHdZBP6WisapRtEDa0JkSpbThT67Ood3JB5cUIawb3Pjt5Tj78jeawuvdZNNJdoCCZCFfojPzEtV4mLyPP900nqOkRKzk')

function caclDiscountPrice(price, discount) {

    if (!discount) {
        return price;
    }
    const discountAmount = (price * discount) / 100;
    return (price - discountAmount).toFixed(2);
}


/**
 * order controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::order.order', ( {strapi} ) => ({

    async paymentOrder(ctx) {
        // envio los datos
        const { token, products, idUser, addressShipping } = ctx.request.body;

        // calculo el total a pagar
        let totalPayment = 0;
        products.forEach( product => {
            const priceTemp = caclDiscountPrice(product.atributes.price, product.atributes.discount);
            totalPayment += priceTemp * product.quantity;
        });

        // creo el pago con stripe
        const charge = await stripe.charges.create({
            amount: Math.round(totalPayment * 100),
            currency: 'USD',
            source: token.id,
            description: `ID User: ${idUser}`
        });

        // creo la informacion que se va a guardar en la base de datos
        const data = {
            products,
            user:  idUser,
            idPayment: charge.id,
            addressShipping,
            totalPayment,
            status: 'pending',
        };

        // obtengo el modelo sobre el cual voy a registrar los datos
        const model = strapi.contentTypes['api::order.order'];
        // compruebo que el modelo y los datos que se van a guardar sean iguales
        const validData = await strapi.entityValidator.validateEntityCreation(model, data);
        // guardo los datos en la base de datos
        const entry = await strapi.query('api::order.order').create( { data: validData } );

        // devuelvo respuesta al cliente para que sepa que se hizo el pago correctamente
        return entry;
    } ,

    
}) );
