import { expect } from 'chai';
import * as sinon from 'sinon';
import { TeardownLogic } from '../src/internal/types';
import { Observable, config, Subscription, Subscriber, Operator, NEVER, Subject, of, throwError, EMPTY } from 'rxjs';
import { map, filter, count, tap, combineLatestWith, concatWith, mergeWith, raceWith, zipWith, catchError, share} from 'rxjs/operators';
import { TestScheduler } from 'rxjs/testing';
import { observableMatcher } from './helpers/observableMatcher';

function expectFullObserver(val: any) {
  expect(val).to.be.a('object');
  expect(val.next).to.be.a('function');
  expect(val.error).to.be.a('function');
  expect(val.complete).to.be.a('function');
  expect(val.closed).to.be.a('boolean');
}

/** @test {Observable} */
describe('Observable', () => {
  let rxTestScheduler: TestScheduler;

  beforeEach(() => {
    rxTestScheduler = new TestScheduler(observableMatcher);
  });

  it('should be constructed with a subscriber function', (done) => {
    const source = new Observable<number>(function (observer) {
      expectFullObserver(observer);
      observer.next(1);
      observer.complete();
    });

    source.subscribe(
      { next: function (x) {
        expect(x).to.equal(1);
      }, complete: done }
    );
  });

  it('should send errors thrown in the constructor down the error path', (done) => {
    new Observable<number>(() => {
      throw new Error('this should be handled');
    }).subscribe({
      error(err) {
        expect(err).to.exist.and.be.instanceof(Error).and.have.property('message', 'this should be handled');
        done();
      },
    });
  });

  it('should allow empty ctor, which is effectively a never-observable', () => {
    rxTestScheduler.run(({ expectObservable }) => {
      const result = new Observable<any>();
      expectObservable(result).toBe('-');
    });
  });

  describe('forEach', () => {
    it('should iterate and return a Promise', (done) => {
      const expected = [1, 2, 3];
      const result = of(1, 2, 3)
        .forEach((x) => {
          expect(x).to.equal(expected.shift());
        })
        .then(() => {
          done();
        });

      expect(result.then).to.be.a('function');
    });

    it('should reject promise when in error', (done) => {
      throwError(() => ('bad'))
        .forEach(() => {
          done(new Error('should not be called'));
        })
        .then(
          () => {
            done(new Error('should not complete'));
          },
          (err) => {
            expect(err).to.equal('bad');
            done();
          }
        );
    });

    it('should reject promise if nextHandler throws', (done) => {
      const results: number[] = [];

      of(1, 2, 3)
        .forEach((x) => {
          if (x === 3) {
            throw new Error('NO THREES!');
          }
          results.push(x);
        })
        .then(
          () => {
            done(new Error('should not be called'));
          },
          (err) => {
            expect(err).to.be.an('error', 'NO THREES!');
            expect(results).to.deep.equal([1, 2]);
          }
        )
        .then(() => {
          done();
        });
    });

    it('should handle a synchronous throw from the next handler', () => {
      const expected = new Error('I told, you Bobby Boucher, threes are the debil!');
      const syncObservable = new Observable<number>((observer) => {
        observer.next(1);
        observer.next(2);
        observer.next(3);
        observer.next(4);
      });

      const results: Array<number | Error> = [];

      return syncObservable
        .forEach((x) => {
          results.push(x);
          if (x === 3) {
            throw expected;
          }
        })
        .then(
          () => {
            throw new Error('should not be called');
          },
          (err) => {
            results.push(err);
            // The error should unsubscribe from the source, meaning we
            // should not see the number 4.
            expect(results).to.deep.equal([1, 2, 3, expected]);
          }
        );
    });

    it('should handle an asynchronous throw from the next handler and tear down', () => {
      const expected = new Error('I told, you Bobby Boucher, twos are the debil!');
      const asyncObservable = new Observable<number>((observer) => {
        let i = 1;
        const id = setInterval(() => observer.next(i++), 1);

        return () => {
          clearInterval(id);
        };
      });

      const results: Array<number | Error> = [];

      return asyncObservable
        .forEach((x) => {
          results.push(x);
          if (x === 2) {
            throw expected;
          }
        })
        .then(
          () => {
            throw new Error('should not be called');
          },
          (err) => {
            results.push(err);
            expect(results).to.deep.equal([1, 2, expected]);
          }
        );
    });
  });

  describe('subscribe', () => {
    it('should work with handlers with hacked bind methods', () => {
      const source = of('Hi');
      const results: any[] = [];
      const next = function (value: string) {
        results.push(value);
      }
      next.bind = () => { /* lol */};

      const complete = function () {
        results.push('done');
      }
      complete.bind = () => { /* lol */};

      source.subscribe({ next, complete });
      expect(results).to.deep.equal(['Hi', 'done']);
    });

    it('should work with handlers with hacked bind methods, in the error case', () => {
      const source = throwError(() => 'an error');
      const results: any[] = [];
      const error = function (value: string) {
        results.push(value);
      }

      source.subscribe({ error });
      expect(results).to.deep.equal(['an error']);
    });

    it('should be synchronous', () => {
      let subscribed = false;
      let nexted: string;
      let completed: boolean;
      const source = new Observable<string>((observer) => {
        subscribed = true;
        observer.next('wee');
        expect(nexted).to.equal('wee');
        observer.complete();
        expect(completed).to.be.true;
      });

      expect(subscribed).to.be.false;

      let mutatedByNext = false;
      let mutatedByComplete = false;

      source.subscribe(
        { next: (x) => {
          nexted = x;
          mutatedByNext = true;
        }, complete: () => {
          completed = true;
          mutatedByComplete = true;
        } }
      );

      expect(mutatedByNext).to.be.true;
      expect(mutatedByComplete).to.be.true;
    });

    it('should work when subscribe is called with no arguments', () => {
      const source = new Observable<string>((subscriber) => {
        subscriber.next('foo');
        subscriber.complete();
      });

      source.subscribe();
    });

    it('should not be unsubscribed when other empty subscription completes', () => {
      let unsubscribeCalled = false;
      const source = new Observable<number>(() => {
        return () => {
          unsubscribeCalled = true;
        };
      });

      source.subscribe();

      expect(unsubscribeCalled).to.be.false;

      EMPTY.subscribe();

      expect(unsubscribeCalled).to.be.false;
    });

    it('should not be unsubscribed when other subscription with same observer completes', () => {
      let unsubscribeCalled = false;
      const source = new Observable<number>(() => {
        return () => {
          unsubscribeCalled = true;
        };
      });

      let observer = {
        next: function () {
          /*noop*/
        },
      };

      source.subscribe(observer);

      expect(unsubscribeCalled).to.be.false;

      EMPTY.subscribe(observer);

      expect(unsubscribeCalled).to.be.false;
    });

    it('should run unsubscription logic when an error is sent asynchronously and subscribe is called with no arguments', (done) => {
      const sandbox = sinon.createSandbox();
      const fakeTimer = sandbox.useFakeTimers();

      let unsubscribeCalled = false;
      const source = new Observable<number>((observer) => {
        const id = setInterval(() => {
          observer.error(0);
        }, 1);
        return () => {
          clearInterval(id);
          unsubscribeCalled = true;
        };
      });

      source.subscribe({
        error() {
          /* noop: expected error */
        },
      });

      setTimeout(() => {
        let err;
        let errHappened = false;
        try {
          expect(unsubscribeCalled).to.be.true;
        } catch (e) {
          err = e;
          errHappened = true;
        } finally {
          if (!errHappened) {
            done();
          } else {
            done(err);
          }
        }
      }, 100);

      fakeTimer.tick(110);
      sandbox.restore();
    });

    it('should return a Subscription that calls the unsubscribe function returned by the subscriber', () => {
      let unsubscribeCalled = false;

      const source = new Observable<number>(() => {
        return () => {
          unsubscribeCalled = true;
        };
      });

      const sub = source.subscribe(() => {
        //noop
      });
      expect(sub instanceof Subscription).to.be.true;
      expect(unsubscribeCalled).to.be.false;
      expect(sub.unsubscribe).to.be.a('function');

      sub.unsubscribe();
      expect(unsubscribeCalled).to.be.true;
    });

    it('should ignore next messages after unsubscription', (done) => {
      let times = 0;

      const subscription = new Observable<number>((observer) => {
        let i = 0;
        const id = setInterval(() => {
          observer.next(i++);
        });

        return () => {
          clearInterval(id);
          expect(times).to.equal(2);
          done();
        };
      })
        .pipe(tap(() => (times += 1)))
        .subscribe(function () {
          if (times === 2) {
            subscription.unsubscribe();
          }
        });
    });

    it('should ignore error messages after unsubscription', (done) => {
      let times = 0;
      let errorCalled = false;

      const subscription = new Observable<number>((observer) => {
        let i = 0;
        const id = setInterval(() => {
          observer.next(i++);
          if (i === 3) {
            observer.error(new Error());
          }
        });

        return () => {
          clearInterval(id);
          expect(times).to.equal(2);
          expect(errorCalled).to.be.false;
          done();
        };
      })
        .pipe(tap(() => (times += 1)))
        .subscribe(
          { next: function () {
            if (times === 2) {
              subscription.unsubscribe();
            }
          }, error: function () {
            errorCalled = true;
          } }
        );
    });

    it('should ignore complete messages after unsubscription', (done) => {
      let times = 0;
      let completeCalled = false;

      const subscription = new Observable<number>((observer) => {
        let i = 0;
        const id = setInterval(() => {
          observer.next(i++);
          if (i === 3) {
            observer.complete();
          }
        });

        return () => {
          clearInterval(id);
          expect(times).to.equal(2);
          expect(completeCalled).to.be.false;
          done();
        };
      })
        .pipe(tap(() => (times += 1)))
        .subscribe(
          { next: function () {
            if (times === 2) {
              subscription.unsubscribe();
            }
          }, complete: function () {
            completeCalled = true;
          } }
        );
    });

    describe('when called with an anonymous observer', () => {
      it(
        'should accept an anonymous observer with just a next function and call the next function in the context' +
          ' of the anonymous observer',
        (done) => {
          //intentionally not using lambda to avoid typescript's this context capture
          const o = {
            myValue: 'foo',
            next(x: any) {
              expect(this.myValue).to.equal('foo');
              expect(x).to.equal(1);
              done();
            },
          };

          of(1).subscribe(o);
        }
      );

      it(
        'should accept an anonymous observer with just an error function and call the error function in the context' +
          ' of the anonymous observer',
        (done) => {
          //intentionally not using lambda to avoid typescript's this context capture
          const o = {
            myValue: 'foo',
            error(err: any) {
              expect(this.myValue).to.equal('foo');
              expect(err).to.equal('bad');
              done();
            },
          };

          throwError(() => ('bad')).subscribe(o);
        }
      );

      it(
        'should accept an anonymous observer with just a complete function and call the complete function in the' +
          ' context of the anonymous observer',
        (done) => {
          //intentionally not using lambda to avoid typescript's this context capture
          const o = {
            myValue: 'foo',
            complete: function complete() {
              expect(this.myValue).to.equal('foo');
              done();
            },
          };

          EMPTY.subscribe(o);
        }
      );

      it('should accept an anonymous observer with no functions at all', () => {
        expect(() => {
          EMPTY.subscribe(<any>{});
        }).not.to.throw();
      });

      it('should ignore next messages after unsubscription', (done) => {
        let times = 0;

        const subscription = new Observable<number>((observer) => {
          let i = 0;
          const id = setInterval(() => {
            observer.next(i++);
          });

          return () => {
            clearInterval(id);
            expect(times).to.equal(2);
            done();
          };
        })
          .pipe(tap(() => (times += 1)))
          .subscribe({
            next() {
              if (times === 2) {
                subscription.unsubscribe();
              }
            },
          });
      });

      it('should ignore error messages after unsubscription', (done) => {
        let times = 0;
        let errorCalled = false;

        const subscription = new Observable<number>((observer) => {
          let i = 0;
          const id = setInterval(() => {
            observer.next(i++);
            if (i === 3) {
              observer.error(new Error());
            }
          });
          return () => {
            clearInterval(id);
            expect(times).to.equal(2);
            expect(errorCalled).to.be.false;
            done();
          };
        })
          .pipe(tap(() => (times += 1)))
          .subscribe({
            next() {
              if (times === 2) {
                subscription.unsubscribe();
              }
            },
            error() {
              errorCalled = true;
            },
          });
      });

      it('should ignore complete messages after unsubscription', (done) => {
        let times = 0;
        let completeCalled = false;

        const subscription = new Observable<number>((observer) => {
          let i = 0;
          const id = setInterval(() => {
            observer.next(i++);
            if (i === 3) {
              observer.complete();
            }
          });

          return () => {
            clearInterval(id);
            expect(times).to.equal(2);
            expect(completeCalled).to.be.false;
            done();
          };
        })
          .pipe(tap(() => (times += 1)))
          .subscribe({
            next() {
              if (times === 2) {
                subscription.unsubscribe();
              }
            },
            complete() {
              completeCalled = true;
            },
          });
      });
    });

    it('should finalize even with a synchronous thrown error', () => {
      let called = false;
      const badObservable = new Observable((subscriber) => {
        subscriber.add(() => {
          called = true;
        });

        throw new Error('bad');
      });

      badObservable.subscribe({
        error: () => { /* do nothing */ }
      });

      expect(called).to.be.true;
    });


    it('should handle empty string sync errors', () => {
      const badObservable = new Observable(() => {
        throw '';
      });

      let caught = false;
      badObservable.subscribe({
        error: (err) => {
          caught = true;
          expect(err).to.equal('');
        }
      });
      expect(caught).to.be.true;
    });
  });

  describe('pipe', () => {
    it('should exist', () => {
      const source = of('test');
      expect(source.pipe).to.be.a('function');
    });

    it('should pipe multiple operations', (done) => {
      of('test')
        .pipe(
          map((x) => x + x),
          map((x) => x + '!!!')
        )
        .subscribe(
          { next: (x) => {
            expect(x).to.equal('testtest!!!');
          }, complete: done }
        );
    });

    it('should return the same observable if there are no arguments', () => {
      const source = of('test');
      const result = source.pipe();
      expect(result).to.equal(source);
    });
  });

  it('should not swallow internal errors', (done) => {
    config.onStoppedNotification = (notification) => {
      expect(notification.kind).to.equal('E');
      expect(notification).to.have.property('error', 'bad');
      config.onStoppedNotification = null;
      done();
    };

    new Observable(subscriber => {
      subscriber.error('test');
      throw 'bad';
    }).subscribe({
      error: err => {
        expect(err).to.equal('test');
      }
    });
  });

  // Discussion here: https://github.com/ReactiveX/rxjs/issues/5370
  it.skip('should handle sync errors within a test scheduler', () => {
    const observable = of(4).pipe(
      map(n => {
          if (n === 4) {
            throw 'four!';
        }
        return n;
      }),
      catchError((err, source) => source),
    );

    rxTestScheduler.run(helpers => {
      const { expectObservable } = helpers;
      expectObservable(observable).toBe('-');
    });
  });

  it('should emit an error for unhandled synchronous exceptions from something like a stack overflow', () => {
    const source = new Observable(() => {
      const boom = (): unknown => boom();
      boom();
    });

    let thrownError: any = undefined;
    source.subscribe({
      error: err => thrownError = err
    });

    expect(thrownError).to.be.an.instanceOf(RangeError);
    expect(thrownError.message).to.equal('Maximum call stack size exceeded');
  });
});


/** @test {Observable} */
describe('Observable.lift', () => {
  let rxTestScheduler: TestScheduler;

  beforeEach(() => {
    rxTestScheduler = new TestScheduler(observableMatcher);
  });

  class MyCustomObservable<T> extends Observable<T> {
    static from<T>(source: any) {
      const observable = new MyCustomObservable<T>();
      observable.source = <Observable<T>>source;
      return observable;
    }
    lift<R>(operator: Operator<T, R>): Observable<R> {
      const observable = new MyCustomObservable<R>();
      (<any>observable).source = this;
      (<any>observable).operator = operator;
      return observable;
    }
  }

  it('should return Observable which calls FinalizationLogic of operator on unsubscription', (done) => {
    const myOperator: Operator<any, any> = {
      call: (subscriber: Subscriber<any>, source: any) => {
        const subscription = source.subscribe((x: any) => subscriber.next(x));
        return () => {
          subscription.unsubscribe();
          done();
        };
      },
    };

    (NEVER as any).lift(myOperator)
      .subscribe()
      .unsubscribe();

  });

  it('should be overridable in a custom Observable type that composes', (done) => {
    const result = new MyCustomObservable<number>((observer) => {
      observer.next(1);
      observer.next(2);
      observer.next(3);
      observer.complete();
    }).pipe(
      map((x) => {
        return 10 * x;
      })
    );

    expect(result instanceof MyCustomObservable).to.be.true;

    const expected = [10, 20, 30];

    result.subscribe(
      { next: function (x) {
        expect(x).to.equal(expected.shift());
      }, error: () => {
        done(new Error('should not be called'));
      }, complete: () => {
        done();
      } }
    );
  });


  it('should composes Subjects in the simple case', () => {
    const subject = new Subject<number>();

    const result = subject.pipe(
      map((x) => 10 * x)
    ) as any as Subject<number>; // Yes, this is correct. (but you're advised not to do this)

    expect(result instanceof Subject).to.be.true;

    const emitted: any[] = [];
    result.subscribe(value => emitted.push(value));

    result.next(10);
    result.next(20);
    result.next(30);

    expect(emitted).to.deep.equal([100, 200, 300]);
  });

  /**
   * Seriously, never do this. It's probably bad that we've allowed this. Fortunately, it's not
   * a common practice, so maybe we can remove it?
   */
  it('should demonstrate the horrors of sharing and lifting the Subject through', () => {
    const subject = new Subject<number>();

    const shared = subject.pipe(
      share()
    );

    const result1 = shared.pipe(
      map(x => x * 10)
    ) as any as Subject<number>; // Yes, this is correct.

    const result2 = shared.pipe(
      map(x => x - 10)
    ) as any as Subject<number>; // Yes, this is correct.
    expect(result1 instanceof Subject).to.be.true;

    const emitted1: any[] = [];
    result1.subscribe(value => emitted1.push(value));

    const emitted2: any[] = [];
    result2.subscribe(value => emitted2.push(value));

    // THIS IS HORRIBLE DON'T DO THIS.
    result1.next(10);
    result2.next(20); // Yuck
    result1.next(30);

    expect(emitted1).to.deep.equal([100, 200, 300]);
    expect(emitted2).to.deep.equal([0, 10, 20]);
  });

  it('should compose through combineLatestWith', () => {
    rxTestScheduler.run(({ cold, expectObservable }) => {
      const e1 = cold(' -a--b-----c-d-e-|');
      const e2 = cold(' --1--2-3-4---|   ');
      const expected = '--A-BC-D-EF-G-H-|';

      const result = MyCustomObservable.from(e1).pipe(
        combineLatestWith(e2),
        map(([a, b]) => String(a) + String(b))
      );

      expect(result instanceof MyCustomObservable).to.be.true;

      expectObservable(result).toBe(expected, {
        A: 'a1',
        B: 'b1',
        C: 'b2',
        D: 'b3',
        E: 'b4',
        F: 'c4',
        G: 'd4',
        H: 'e4',
      });
    });
  });

  it('should compose through concatWith', () => {
    rxTestScheduler.run(({ cold, expectObservable }) => {
      const e1 = cold(' --a--b-|');
      const e2 = cold(' --x---y--|');
      const expected = '--a--b---x---y--|';

      const result = MyCustomObservable.from(e1).pipe(concatWith(e2));

      expect(result instanceof MyCustomObservable).to.be.true;

      expectObservable(result).toBe(expected);
    });
  });
  it('should compose through mergeWith', () => {
    rxTestScheduler.run(({ cold, expectObservable }) => {
      const e1 = cold(' -a--b-| ');
      const e2 = cold(' --x--y-|');
      const expected = '-ax-by-|';

      const result = MyCustomObservable.from(e1).pipe(mergeWith(e2));

      expect(result instanceof MyCustomObservable).to.be.true;

      expectObservable(result).toBe(expected);
    });
  });

  it('should compose through raceWith', () => {
    rxTestScheduler.run(({ cold, expectObservable, expectSubscriptions }) => {
      const e1 = cold(' ---a-----b-----c----|');
      const e1subs = '  ^-------------------!';
      const e2 = cold(' ------x-----y-----z----|');
      const e2subs = '  ^--!';
      const expected = '---a-----b-----c----|';

      const result = MyCustomObservable.from<string>(e1).pipe(
        raceWith(e2)
      );

      expect(result instanceof MyCustomObservable).to.be.true;

      expectObservable(result).toBe(expected);
      expectSubscriptions(e1.subscriptions).toBe(e1subs);
      expectSubscriptions(e2.subscriptions).toBe(e2subs);
    });
  });

  it('should compose through zipWith', () => {
    rxTestScheduler.run(({ cold, expectObservable }) => {
      const e1 = cold(' -a--b-----c-d-e-|');
      const e2 = cold(' --1--2-3-4---|   ');
      const expected = '--A--B----C-D|   ';

      const result = MyCustomObservable.from(e1).pipe(zipWith(e2));

      expect(result instanceof MyCustomObservable).to.be.true;

      expectObservable(result).toBe(expected, {
        A: ['a', '1'],
        B: ['b', '2'],
        C: ['c', '3'],
        D: ['d', '4'],
      });
    });
  });

  it('should allow injecting behaviors into all subscribers in an operator ' + 'chain when overridden', (done) => {
    // The custom Subscriber
    const log: Array<string> = [];

    class LogSubscriber<T> extends Subscriber<T> {
      next(value?: T): void {
        log.push('next ' + value);
        if (!this.isStopped) {
          this._next(value!);
        }
      }
    }

    // The custom Operator
    class LogOperator<T, R> implements Operator<T, R> {
      constructor(private childOperator: Operator<T, R>) {}

      call(subscriber: Subscriber<R>, source: any): TeardownLogic {
        return this.childOperator.call(new LogSubscriber<R>(subscriber), source);
      }
    }

    // The custom Observable
    class LogObservable<T> extends Observable<T> {
      lift<R>(operator: Operator<T, R>): Observable<R> {
        const observable = new LogObservable<R>();
        observable.source = this;
        observable.operator = new LogOperator(operator);
        return observable;
      }
    }

    // Use the LogObservable
    const result = new LogObservable<number>((observer) => {
      observer.next(1);
      observer.next(2);
      observer.next(3);
      observer.complete();
    }).pipe(
      map((x) => 10 * x),
      filter((x) => x > 15),
      count()
    );

    expect(result instanceof LogObservable).to.be.true;

    const expected = [2];

    result.subscribe(
      { next: function (x) {
        expect(x).to.equal(expected.shift());
      }, error: () => {
        done(new Error('should not be called'));
      }, complete: () => {
        expect(log).to.deep.equal([
          'next 10', // map
          'next 20', // map
          'next 20', // filter
          'next 30', // map
          'next 30', // filter
          'next 2', // count
        ]);
        done();
      } }
    );
  });
});
