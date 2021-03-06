var _ = require('lodash');
var async = require('async-chainable');
//var debug = require('debug')('monoxide:interators');

/**
* Create an iterator object
* Either query, cursor or data must be specified for the iterator to work
*
* The iterator objects works by making an operations queue then when we hit .exec() running all items in the queue in an async series.
*
* @param {Object} options Options object used when creating the iterator
* @param {monoxide.queryBuilder} [options.query] The Monoxide queryBuilder object to generate a query from
* @param {Mongoose.QueryCursor} [options.cursor] Cursor object when pulling data
* @param {array} [options.data] Data object to iterate with
* @param {string} [options.method=='cursor'] Method to iterate with
* @param {Object} [options.monoxide] The monoxide master object to operate on
* @param {string} [options.collection] The collection name we are operating on. Inherited from the query.$collection property unless overriden
* @param {boolean} [options.applySchema] Whether to inherit schema defaults. Inherited from the query.$applySchema property unless overridden
* @param {boolean} [options.decorate] Whether to wrap all output objects in a MonoxideDocument. Inherited from the query.$decorate property unless overridden
* @param {boolean} [options.dirty] Whether to mark the document as dirty. Inherited from the query.$dirty property unless overridden
*/
var iteratorObject = function(options) {
	this.settings = _.defaults(options, {
		query: undefined,
		cursor: undefined,
		method: 'cursor',
		data: undefined,
		operations: [],
	});

	this.$operations = {};

	// cursor() - fetch the cursor and wait for it to load {{{
	this.cursor = ()=> {
		this.settings.method = 'cursor';
		this.settings.operations.push({func: this.$operations.cursor});
		return this;
	};

	this.$operations.cursor = done => {
		if (this.settings.cursor) return done(); // Already have a cursor
		this.settings.query.cursor((err, cursor) => {
			if (err) return done(err);
			this.settings.cursor = cursor;
			done();
		});
	};
	// }}}

	// map() - iterate and replace each data item {{{
	this.map = (cb) => {
		this.settings.operations.push({func: this.$operations.map, args: [cb]});
		return this;
	};

	this.$operations.map = (done, cb) => {
		switch (this.settings.method) {
			case 'cursor': // Page the cursor running the callback until the cursor is exhausted
				this.settings.data = [];
				var runner = ()=> {
					this.settings.cursor.next((err, doc) => {
						if (err) {
							throw new Error(err.errmsg || err);
						} else if (doc) { // Found an item - run the callback over it
							if (this.settings.decorate) doc = new this.settings.monoxide.monoxideDocument({
								$collection: this.settings.collection,
								$applySchema: this.settings.applySchema,
								$decorate: this.settings.decorate,
								$dirty: this.settings.dirty,
							}, doc);
							cb.call(doc, (err, res) => {
								if (err) return done(err);
								this.settings.data.push(res); // Push the mapped record into the data array
								setTimeout(runner); // Go fetch the next record in the next tick
							}, doc);
						} else { // Exhausted all documents
							this.settings.method = 'data';
							done();
						}
					});
				};

				runner();
				break;
			case 'data': // Run async.map over every item in the data array and overwrite the previous array
				async()
					.set('iter', this)
					.set('data', this.settings.data)
					.map('data', 'data', cb)
					.end(function(err) {
						if (err) return done(err);
						this.iter.settings.data = this.data;
						done();
					});
				break;
			default:
				throw new Error('Unsupported map iteration method');
		};
	};
	// }}}

	// forEach() - iterate over all data passing a reference to the original data {{{
	this.forEach = (cb) => {
		this.settings.operations.push({func: this.$operations.forEach, args: [cb]});
		return this;
	};

	this.$operations.forEach = (done, cb) => {
		switch (this.settings.method) {
			case 'cursor': // Page the cursor running the callback until the cursor is exhausted
				this.settings.data = [];
				var runner = ()=> {
					this.settings.cursor.next((err, doc) => {
						if (err) {
							throw new Error(err.errmsg || err);
						} else if (doc) { // Found an item - run the callback over it
							if (this.settings.decorate) doc = new this.settings.monoxide.monoxideDocument({
								$collection: this.settings.collection,
								$applySchema: this.settings.applySchema,
								$decorate: this.settings.decorate,
								$dirty: this.settings.dirty,
							}, doc);
							cb.call(doc, err => {
								if (err) return done(err);
								this.settings.data.push(doc); // Push the mapped record into the data array
								setTimeout(runner); // Go fetch the next record
							}, doc);
						} else { // Exhausted all documents
							this.settings.method = 'data';
							done();
						}
					});
				};

				runner();
				break;
			case 'data': // Run async.map over every item in the data array and overwrite the previous array
				async()
					.set('data', this.settings.data)
					.forEach('data', cb)
					.end((err) => {
						if (err) return done(err);
						done();
					});
				break;
			default:
				throw new Error('Unsupported map iteration method');
		};
	};
	// }}}

	// filter() - iterate and optionally filter each item based on a callback response {{{
	this.filter = (cb) => {
		this.settings.operations.push({func: this.$operations.filter, args: [cb]});
		return this;
	};

	this.$operations.filter = (done, cb) => {
		switch (this.settings.method) {
			case 'cursor': // Page the cursor running the callback until the cursor is exhausted
				this.settings.data = [];
				var runner = ()=> {
					this.settings.cursor.next((err, doc) => {
						if (err) {
							throw new Error(err.errmsg || err);
						} else if (doc) { // Found an item - run the callback over it
							if (this.settings.decorate) doc = new this.settings.monoxide.monoxideDocument({
								$collection: this.settings.collection,
								$applySchema: this.settings.applySchema,
								$decorate: this.settings.decorate,
								$dirty: this.settings.dirty,
							}, doc);

							cb.call(doc, (err, res) => {
								if (err) {
									return done(err);
								} else if (res) { // Keep the record?
									this.settings.data.push(doc); // Push the mapped record into the data array
								}
								setTimeout(runner); // Go fetch the next record
							}, doc);
						} else { // Exhausted all documents
							this.settings.method = 'data';
							done();
						}
					});
				};

				runner();
				break;
			case 'data': // Run async.map over every item in the data array and overwrite the previous array
				async()
					.set('iter', this)
					.set('data', this.settings.data)
					.forEach('data', function(next, doc, key) {
						cb.call(doc, (err, res) => {
							if (err) {
								next(err);
							} else if (!res) {
								delete this.data[key];
								next();
							} else {
								next();
							}
						}, doc);
					})
					.end(function(err) {
						if (err) return done(err);
						this.iter.settings.data = this.data.filter(doc => doc);
						done();
					});
				break;
			default:
				throw new Error('Unsupported map iteration method');
		};
	};
	// }}}

	// reduce() - iterate over every item returning a single final result {{{
	this.reduce = (cb, initial) => {
		this.settings.operations.push({func: this.$operations.reduce, args: [cb, initial]});
		return this;
	};

	this.$operations.reduce = (done, cb, initial) => {
		switch (this.settings.method) {
			case 'cursor': // Page the cursor running the callback until the cursor is exhausted
				this.settings.data = [];
				var value = initial;
				var runner = ()=> {
					this.settings.cursor.next((err, doc) => {
						if (err) {
							throw new Error(err.errmsg || err);
						} else if (doc) { // Found an item - run the callback over it
							if (this.settings.decorate) doc = new this.settings.monoxide.monoxideDocument({
								$collection: this.settings.collection,
								$applySchema: this.settings.applySchema,
								$decorate: this.settings.decorate,
								$dirty: this.settings.dirty,
							}, doc);
							cb.call(doc, (err, res) => {
								if (err) return done(err);
								value = res;
								setTimeout(runner); // Go fetch the next record
							}, doc, value);
						} else { // Exhausted all documents
							this.settings.data = value;
							this.settings.method = 'data';
							done();
						}
					});
				};

				runner();
				break;
			case 'data': // Run async.map over every item in the data array and overwrite the previous array
				async()
					.set('iter', this)
					.set('data', this.settings.data)
					.set('value', initial)
					.limit(1)
					.forEach('data', function(next, doc) {
						cb.call(doc, (err, res) => {
							if (err) return next(err);
							this.value = res;
							next();
						}, doc, this.value);
					})
					.end(function(err) {
						if (err) return done(err);
						this.iter.settings.data = this.value;
						done();
					});
				break;
			default:
				throw new Error('Unsupported map iteration method');
		};
	};
	// }}}

	// slurp() - utility function to read all data from a cursor into memory {{{
	this.slurp = ()=> {
		this.settings.operations.push({func: this.$operations.slurp});
		return this;
	};

	this.$operations.slurp = done => {
		this.settings.data = [];
		var runner = ()=> {
			this.settings.cursor.next((err, doc) => {
				if (err) {
					done(err);
				} else if (doc) { // Found an item - run the callback over it
					if (this.settings.decorate) doc = new this.settings.monoxide.monoxideDocument({
						$collection: this.settings.collection,
						$applySchema: this.settings.applySchema,
						$decorate: this.settings.decorate,
						$dirty: this.settings.dirty,
					}, doc);
					this.settings.data.push(doc);
					setTimeout(runner);
				} else { // Exhausted all documents
					this.settings.method = 'data';
					done();
				}
			});
		};

		runner();
	};
	// }}}

	// tap() - analyse a result but don't effect it {{{
	this.tap = (cb) => {
		this.settings.operations.push({func: this.$operations.tap, args: [cb]});
		return this;
	};

	this.$operations.tap = (done, cb) => {
		switch (this.settings.method) {
			case 'cursor': // Slurp all data then re-call ourselves to process the data
				this.$operations.slurp(()=> this.$operations.tap(done, cb));
				break;
			case 'data': // Run async.map over every item in the data array and overwrite the previous array
				cb.call(this.settings.data, done, this.settings.data);
				break;
			default:
				throw new Error('Unsupported map iteration method');
		};
	};
	// }}}

	// thru() - run a function on a data set and use the result {{{
	this.thru = (cb) => {
		this.settings.operations.push({func: this.$operations.thru, args: [cb]});
		return this;
	};

	this.$operations.thru = (done, cb) => {
		switch (this.settings.method) {
			case 'cursor': // Slurp all data then re-call ourselves to process the data
				this.$operations.slurp(()=> this.$operations.thru(done, cb));
				break;
			case 'data': // Run async.map over every item in the data array and overwrite the previous array
				cb.call(this.settings.data, (err, res) => {
					if (err) return done(err);
					this.settings.data = res;
					done();
				}, this.settings.data);
				break;
			default:
				throw new Error('Unsupported map iteration method');
		};
	};
	// }}}

	// Exec - actual operation runner {{{
	this.exec = (cb) => {
		var nextOperation = ()=> {
			var op = this.settings.operations.shift();
			if (!op) { // No more operations to execute - return with data
				cb.call(this, null, this.settings.data);
			} else {
				op.func.apply(this, [nextOperation].concat(op.args));
			}
		};
		nextOperation();
	};
	// }}}

	// Object init + error checking {{{
	if (!this.settings.query && !this.settings.cursor && !this.settings.data) throw new Error('Unable to create iterator object without either query, cursor or data specified in options');
	if (!this.settings.cursor && !this.settings.data) { // Dont have a cursor or data - queue a cursor fetch operation
		this.cursor();
	}
	// }}}

	return this;
};


module.exports = function(finish, monoxide) {
	// Hook into queryBuilder creation stages
	monoxide.hook('queryBuilder', qb => {
		qb.iterator = ()=> new iteratorObject({
			monoxide,
			query: qb,

			// Properties inherited from the query
			collection: qb.query.$collection,
			applySchema: _.isUndefined(qb.query.$applySchema) ? true : qb.$applySchema,
			decorate: _.isUndefined(qb.query.$decorate) ? true : qb.$decorate,
			dirty: _.isUndefined(qb.query.$dirty) ? true : qb.$dirty,
		});

		qb.filter = (...args) => qb
			.iterator()
			.filter(...args);

		qb.map = (...args) => qb
			.iterator()
			.map(...args);

		qb.forEach = (...args) => qb
			.iterator()
			.forEach(...args);

		qb.slurp = (...args) => qb
			.iterator()
			.slurp(...args)

		qb.tap = (...args) => qb
			.iterator()
			.tap(...args)

		qb.thru = (...args) => qb
			.iterator()
			.thru(...args)
	});

	// Hook into aggregation cursors
	monoxide.hook('aggregateCursor', (q, next) => {
		monoxide.models[q.$collection].$mongoModel.aggregate(q.$stages, {
			cursor: {batchSize: 0},
		}, (err, cursor) => {
			next(null, new iteratorObject({
				monoxide, cursor,
				query: q,
				collection: q.$collection,

				// Disable all Monoxide document wrapping
				applySchema: false,
				decorate: false,
				dirty: false,
			}));
		});
	});

	finish();

};

module.exports.iteratorObject = iteratorObject;
