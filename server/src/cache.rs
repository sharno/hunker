use std::{
    collections::{HashMap, VecDeque},
    future::Future,
    hash::Hash,
    sync::Arc,
};

use tokio::sync::{Mutex, OnceCell};

use crate::error::AppResult;

type Cell<V> = Arc<OnceCell<Arc<V>>>;

struct Entries<K, V> {
    cells: HashMap<K, Cell<V>>,
    insertion_order: VecDeque<K>,
}

/// A bounded cache of immutable values where concurrent callers for one key
/// share a single build. The oldest key is evicted first.
pub struct SingleFlightCache<K, V> {
    capacity: usize,
    entries: Arc<Mutex<Entries<K, V>>>,
}

impl<K, V> Clone for SingleFlightCache<K, V> {
    fn clone(&self) -> Self {
        Self {
            capacity: self.capacity,
            entries: Arc::clone(&self.entries),
        }
    }
}

impl<K: Clone + Eq + Hash, V> SingleFlightCache<K, V> {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            entries: Arc::new(Mutex::new(Entries {
                cells: HashMap::new(),
                insertion_order: VecDeque::new(),
            })),
        }
    }

    pub async fn get_or_build<F, Fut>(&self, key: K, build: F) -> AppResult<Arc<V>>
    where
        F: FnOnce(K) -> Fut,
        Fut: Future<Output = AppResult<V>>,
    {
        let cell = self.cell(key.clone()).await;
        let value = cell
            .get_or_try_init(|| async { build(key).await.map(Arc::new) })
            .await?;
        Ok(Arc::clone(value))
    }

    async fn cell(&self, key: K) -> Cell<V> {
        let mut entries = self.entries.lock().await;
        if let Some(cell) = entries.cells.get(&key) {
            return Arc::clone(cell);
        }
        let cell = Arc::new(OnceCell::new());
        entries.cells.insert(key.clone(), Arc::clone(&cell));
        entries.insertion_order.push_back(key);
        while entries.cells.len() > self.capacity {
            let Some(oldest) = entries.insertion_order.pop_front() else {
                break;
            };
            entries.cells.remove(&oldest);
        }
        cell
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    #[tokio::test]
    async fn concurrent_callers_share_one_build() {
        let cache = SingleFlightCache::<&'static str, usize>::new(2);
        let builds = Arc::new(AtomicUsize::new(0));
        let build = |builds: Arc<AtomicUsize>| {
            move |_key| async move {
                builds.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                Ok(42)
            }
        };
        let (first, second) = tokio::join!(
            cache.get_or_build("key", build(Arc::clone(&builds))),
            cache.get_or_build("key", build(Arc::clone(&builds))),
        );
        assert!(Arc::ptr_eq(&first.unwrap(), &second.unwrap()));
        assert_eq!(builds.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn evicts_the_oldest_key_beyond_capacity() {
        let cache = SingleFlightCache::<usize, usize>::new(1);
        let first = cache
            .get_or_build(1, |key| async move { Ok(key) })
            .await
            .unwrap();
        cache
            .get_or_build(2, |key| async move { Ok(key) })
            .await
            .unwrap();
        let rebuilt = cache
            .get_or_build(1, |key| async move { Ok(key) })
            .await
            .unwrap();
        assert!(!Arc::ptr_eq(&first, &rebuilt));
    }
}
